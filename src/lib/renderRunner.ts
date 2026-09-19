/**
 * Runs server renders one at a time: a headless Chromium draws, ffmpeg finishes.
 *
 * Chromium is started straight at the job's render page and given nothing
 * else -- no DevTools protocol, no driver library. The page reports its own
 * progress and uploads its own result over HTTP (`/api/render/worker`), so all
 * this has to do is start the browser, watch the job's status, and stop the
 * browser when the job has moved on. A page that goes quiet for
 * `STALL_MS` is treated as dead, which is what a crashed renderer looks like
 * from here.
 *
 * One at a time because each render already uses what the machine has: the
 * encoder, the decoders for any background clips, and a full frame buffer.
 * Two in parallel would each run at half speed and hold twice the memory.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inputPath, listJobs, newKey, outputPath, picturePath, readJob, readSpec, updateJob, type StoredJob } from './renderJobs';
import { muxArgs } from './serverRender';

/** No word from the render page for this long and it is taken to have died. */
const STALL_MS = 120_000;
const POLL_MS = 1000;

const executable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const onPath = (names: string[]) => {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      if (executable(file)) return file;
    }
  }
  return null;
};

/** Playwright's own Chromium, which is what most machines with a test setup already have. */
function playwrightChromium(): string | null {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  let entries: string[] = [];
  try {
    entries = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse();
  } catch {
    return null;
  }
  for (const entry of entries) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const file = path.join(cache, entry, sub);
      if (executable(file)) return file;
    }
  }
  return null;
}

/** `RENDER_CHROME`, then a Chrome or Chromium on the PATH, then Playwright's. */
export function findChrome(): string | null {
  const configured = process.env.RENDER_CHROME;
  if (configured) return executable(configured) ? configured : null;
  return onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) ?? playwrightChromium();
}

export function findFfmpeg(): string | null {
  const configured = process.env.RENDER_FFMPEG;
  if (configured) return executable(configured) ? configured : null;
  return onPath(['ffmpeg']);
}

export interface RenderAvailability {
  available: boolean;
  /** Why not, in a sentence the studio can show. */
  reason?: string;
}

/**
 * Whether this server can render at all.
 *
 * Off in production unless `RENDER_ENABLED=1`: each job starts a browser and
 * holds the machine for the length of a render, which is fine on the
 * computer the studio runs on and a way to exhaust a shared server.
 */
export function renderAvailability(): RenderAvailability {
  if (process.env.NODE_ENV === 'production' && process.env.RENDER_ENABLED !== '1') {
    return { available: false, reason: 'Server renders are off on this deployment (RENDER_ENABLED).' };
  }
  if (!findChrome()) return { available: false, reason: 'No Chrome or Chromium found for the server to render with (RENDER_CHROME).' };
  if (!findFfmpeg()) return { available: false, reason: 'No ffmpeg found for the server to finish renders with (RENDER_FFMPEG).' };
  return { available: true };
}

interface RunnerState {
  busy: boolean;
  recovered: boolean;
  origin: string;
  current: { id: string; browser: ChildProcess | null } | null;
}

// On `globalThis` so the dev server's module reloads share one runner instead
// of each starting its own loop.
const globalRunner = globalThis as typeof globalThis & { __quranClipperRenderRunner?: RunnerState };
const state: RunnerState = (globalRunner.__quranClipperRenderRunner ??= {
  busy: false,
  recovered: false,
  origin: '',
  current: null,
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function launchBrowser(chrome: string, url: string, profile: string): ChildProcess {
  const extra = (process.env.RENDER_CHROME_FLAGS || '').split(/\s+/).filter(Boolean);
  return spawn(chrome, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    // A headless page is never "visible", and these are what would otherwise
    // slow its timers and decoders to a background tab's pace.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...extra,
    url,
  ], { stdio: 'ignore' });
}

/** Waits until the page has uploaded its picture, failed, been cancelled, or gone quiet. */
async function watch(id: string, browser: ChildProcess): Promise<StoredJob | null> {
  let exited = false;
  browser.once('exit', () => { exited = true; });
  const check = async (): Promise<StoredJob | null> => {
    const job = await sleep(POLL_MS).then(() => readJob(id));
    if (!job || job.status !== 'rendering') return job;
    if (exited) return updateJob(id, () => ({ status: 'failed', error: 'The render browser closed before it finished.' }));
    if (Date.now() - Date.parse(job.updatedAt) > STALL_MS) {
      return updateJob(id, () => ({ status: 'failed', error: 'The render stopped responding.' }));
    }
    return check();
  };
  return check();
}

function mux(job: StoredJob, start: number, end: number): Promise<string | null> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve('ffmpeg is no longer available.');
  const args = muxArgs({
    video: picturePath(job.id),
    audio: inputPath(job.id, 'audio'),
    start,
    end,
    output: outputPath(job),
  });
  return new Promise(resolve => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    proc.once('error', err => resolve(err.message));
    proc.once('close', code => resolve(code === 0 ? null : (stderr.trim() || 'ffmpeg failed').split('\n').slice(-3).join(' ')));
  });
}

/** What a call from this server to its own routes needs behind `STUDIO_TOKEN`. */
export const studioAuth = (): Record<string, string> =>
  (process.env.STUDIO_TOKEN ? { Authorization: `Bearer ${process.env.STUDIO_TOKEN}` } : {});

/** The export log's note that this render happened, as the studio writes it for a tab render. */
async function recordExport(job: StoredJob, aspectRatio: string) {
  try {
    await fetch(new URL('/api/exports', state.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studioAuth() },
      body: JSON.stringify({
        title: job.title,
        fileName: job.fileName,
        fileSizeBytes: job.bytes,
        aspectRatio,
        duration: Math.round(job.durationSec),
        resolution: `${job.width}x${job.height}`,
        fps: job.fps,
        renderTimeMs: job.elapsedMs,
        gpuDevice: 'Server render (headless Chromium + ffmpeg)',
      }),
    });
  } catch (err) {
    // The log is a convenience; the file is what was asked for, so a failure
    // here is reported and the render still counts as done.
    console.warn('[render] could not add the export log entry:', err);
  }
}

async function finish(job: StoredJob, startedAt: number) {
  const spec = await readSpec(job.id);
  if (!spec) {
    await updateJob(job.id, () => ({ status: 'failed', error: 'The job lost its description.' }));
    return;
  }
  const error = await mux(job, spec.range.start, spec.range.end);
  if (error) {
    await updateJob(job.id, () => ({ status: 'failed', error }));
    return;
  }
  await rm(picturePath(job.id), { force: true });
  const done = await updateJob(job.id, current => (current.status === 'finishing'
    ? { status: 'done', progress: 100, bytes: statSync(outputPath(job)).size, elapsedMs: Date.now() - startedAt }
    : null));
  if (done?.status === 'done') await recordExport(done, spec.config.aspectRatio);
}

async function run(job: StoredJob) {
  const chrome = findChrome();
  if (!chrome) {
    await updateJob(job.id, () => ({ status: 'failed', error: 'No Chrome or Chromium to render with.' }));
    return;
  }
  const startedAt = Date.now();
  const key = newKey();
  await updateJob(job.id, () => ({ status: 'rendering', progress: 0, error: undefined, key, startedAt: new Date().toISOString() }));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'quranclipper-render-'));
  const url = new URL(`/render?id=${job.id}&key=${key}`, state.origin);
  // Behind `STUDIO_TOKEN` the page is as closed to this browser as to anyone:
  // it signs in the way a person does, and the middleware swaps the token for
  // a cookie before the page loads.
  if (process.env.STUDIO_TOKEN) url.searchParams.set('token', process.env.STUDIO_TOKEN);
  const browser = launchBrowser(chrome, url.href, profile);
  state.current = { id: job.id, browser };
  await updateJob(job.id, () => ({ browserPid: browser.pid }));
  try {
    const after = await watch(job.id, browser);
    browser.kill('SIGKILL');
    if (after?.status === 'finishing') await finish(after, startedAt);
  } finally {
    browser.kill('SIGKILL');
    state.current = null;
    await rm(profile, { recursive: true, force: true });
  }
}

/**
 * A job the server was in the middle of when it stopped is run again from the
 * start: its browser went with the process, and a half-written picture is of
 * no use to anyone.
 */
async function recover() {
  if (state.recovered) return;
  state.recovered = true;
  const interrupted = (await listJobs()).filter(job => job.status === 'rendering' || job.status === 'finishing');
  await Promise.all(interrupted.map(job => {
    stopOrphan(job);
    return updateJob(job.id, () => ({ status: 'queued', progress: 0, browserPid: undefined }));
  }));
}

/**
 * A browser outlives the server that started it, and would go on rendering
 * the job into nothing. Stopped only when its command line names the job, so
 * a recycled pid belonging to something else is left alone.
 */
function stopOrphan(job: StoredJob): boolean {
  if (!job.browserPid) return false;
  try {
    const cmdline = readFileSync(`/proc/${job.browserPid}/cmdline`, 'utf8');
    return cmdline.includes(job.id) && process.kill(job.browserPid, 'SIGKILL');
  } catch {
    // Already gone, or not a system with /proc: nothing to stop from here.
    return false;
  }
}

/** Starts working through the queue, unless it already is. */
export function kickRenders(origin: string) {
  state.origin = origin;
  if (state.busy) return;
  state.busy = true;
  // Oldest first; each job is only looked for once the one before has ended.
  const drain = async (): Promise<void> => {
    const next = (await listJobs()).filter(job => job.status === 'queued').at(-1);
    if (next) return run(next).then(drain);
  };
  void recover()
    .then(drain)
    .catch(err => console.error('[render] the queue stopped:', err))
    .finally(() => { state.busy = false; });
}

/** Stops a job, whether it is waiting or running. */
export async function cancelRender(id: string) {
  const job = await updateJob(id, current => (current.status === 'queued' || current.status === 'rendering' || current.status === 'finishing'
    ? { status: 'cancelled' }
    : null));
  if (state.current?.id === id) state.current.browser?.kill('SIGKILL');
  return job;
}
