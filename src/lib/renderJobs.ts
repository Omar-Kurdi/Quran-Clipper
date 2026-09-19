/**
 * Server renders, kept on disk under `data/renders/<id>/`.
 *
 * On disk rather than in the database because what a job holds is files -- the
 * recording, uploaded backgrounds, the rendered picture, the finished video --
 * and because a job has to outlive the process: a server restarted mid-render
 * finds the job again and runs it from the start. `data/` is gitignored.
 *
 *   job.json     the job as the list shows it, plus its worker key
 *   spec.json    what the render page draws (`RenderSpec`)
 *   audio        the recording; `bg-N` the uploaded backgrounds
 *   picture.mp4  what the headless browser encoded
 *   <fileName>   the finished file, picture plus AAC audio
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { isInputName, isRenderId, parseRenderSpec, type RenderJob, type RenderSpec } from './serverRender';

export const RENDER_ROOT = path.join(process.cwd(), 'data', 'renders');

/** A job as stored: the listed fields, and what only the worker may know. */
export interface StoredJob extends RenderJob {
  /** Proves a worker request came from the page this job launched. */
  key: string;
  /** Content types of the uploaded inputs, to serve them back as what they are. */
  inputTypes: Record<string, string>;
  startedAt?: string;
  /** The render browser, so a restarted server can stop one its predecessor left running. */
  browserPid?: number;
}

/** A fresh worker key. Each run gets its own, so a browser from an earlier run cannot report into this one. */
export const newKey = () => randomBytes(16).toString('hex');

export const jobDir = (id: string) => {
  if (!isRenderId(id)) throw new Error('not a render id');
  return path.join(RENDER_ROOT, id);
};

export const inputPath = (id: string, name: string) => {
  if (!isInputName(name)) throw new Error('not an input name');
  return path.join(jobDir(id), name);
};

export const picturePath = (id: string) => path.join(jobDir(id), 'picture.mp4');

/** The finished file, under the name the studio gave it. `path.basename` keeps it in the job's folder. */
export const outputPath = (job: Pick<RenderJob, 'id' | 'fileName'>) =>
  path.join(jobDir(job.id), path.basename(job.fileName) || 'render.mp4');

/**
 * Written to a temporary name and renamed, so a reader never sees half a job:
 * the render page reports progress while the runner reads status, and a
 * truncated `job.json` would read as a job that does not exist.
 */
async function writeJson(file: string, value: unknown) {
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await rename(temp, file);
}

const readText = (file: string) => readFile(file, 'utf8').catch(() => null);

/** A stored job, or null when the file is missing, half-written or not one of ours. */
function parseJob(text: string | null, id: string): StoredJob | null {
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
  const job = value as Partial<StoredJob> | null;
  return job && job.id === id && typeof job.status === 'string' && typeof job.key === 'string'
    ? (job as StoredJob)
    : null;
}

export async function readJob(id: string): Promise<StoredJob | null> {
  return parseJob(await readText(path.join(jobDir(id), 'job.json')), id);
}

export async function readSpec(id: string): Promise<RenderSpec | null> {
  const text = await readText(path.join(jobDir(id), 'spec.json'));
  return text ? parseRenderSpec(text) : null;
}

/**
 * One update at a time per job. Progress from the page and status from the
 * runner arrive concurrently, and two read-modify-writes interleaved would
 * put back whichever status the slower one read.
 */
const locks = new Map<string, Promise<unknown>>();

export function updateJob(id: string, change: (job: StoredJob) => Partial<StoredJob> | null): Promise<StoredJob | null> {
  const run = async () => {
    const job = await readJob(id);
    if (!job) return null;
    const patch = change(job);
    if (!patch) return job;
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await writeJson(path.join(jobDir(id), 'job.json'), next);
    return next;
  };
  const result = (locks.get(id) ?? Promise.resolve()).then(run, run);
  locks.set(id, result.catch(() => null));
  return result;
}

/** Every file the job names, read from the request -- or the first that is missing. */
export async function inputsFromForm(form: FormData, spec: RenderSpec) {
  const names = ['audio', ...spec.media.map(media => media.name)];
  const files = names.map(name => form.get(name));
  const missing = names.find((_, i) => !(files[i] instanceof File) || (files[i] as File).size === 0);
  if (missing) return { missing };
  const inputs = await Promise.all((files as File[]).map(async (file, i) => ({
    name: names[i],
    data: Buffer.from(await file.arrayBuffer()),
    type: file.type || 'application/octet-stream',
  })));
  return { inputs };
}

export async function createJob(
  spec: RenderSpec,
  inputs: { name: string; data: Buffer; type: string }[]
): Promise<StoredJob> {
  const id = `r_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  await mkdir(jobDir(id), { recursive: true });
  await Promise.all(inputs.map(input => writeFile(inputPath(id, input.name), input.data)));
  const now = new Date().toISOString();
  const job: StoredJob = {
    id,
    status: 'queued',
    progress: 0,
    title: spec.title,
    fileName: path.basename(spec.fileName) || 'render.mp4',
    width: spec.plan.width,
    height: spec.plan.height,
    fps: spec.plan.fps,
    durationSec: Math.max(0, spec.range.end - spec.range.start),
    createdAt: now,
    updatedAt: now,
    key: newKey(),
    inputTypes: Object.fromEntries(inputs.map(input => [input.name, input.type])),
  };
  await writeJson(path.join(jobDir(id), 'spec.json'), spec);
  await writeJson(path.join(jobDir(id), 'job.json'), job);
  return job;
}

export async function listJobs(): Promise<StoredJob[]> {
  let names: string[] = [];
  try {
    names = await readdir(RENDER_ROOT);
  } catch {
    return [];
  }
  const jobs = await Promise.all(names.filter(isRenderId).map(readJob));
  return jobs
    .filter((job): job is StoredJob => job !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const removeJob = (id: string) => rm(jobDir(id), { recursive: true, force: true });

/** The job without what only the worker should see. */
export function publicJob(job: StoredJob): RenderJob {
  const { key: _key, inputTypes: _types, startedAt: _started, browserPid: _pid, ...listed } = job;
  return listed;
}
