/**
 * Several renders of one project, run one after another.
 *
 * The usual reason is platforms: the same recitation as a 9:16 Reel, a 16:9
 * YouTube upload and a 1:1 post. Each job is a platform preset, a quality tier
 * and a frame rate -- what the export modal already asks for -- and the queue
 * runs them in order, keeping each finished file until it is downloaded.
 *
 * It runs in this tab, on the same export path as a single render. Closing the
 * tab ends it; a queue that survives that needs a server-side renderer, which
 * the studio does not have. The modal says so while it runs.
 *
 * Pure state here, so the order rules can be tested without a canvas. The
 * modal owns running a job.
 */

import type { QualityTier } from './exportPresets';

export type JobStatus = 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';

export interface ExportJob {
  id: string;
  presetId: string;
  aspectRatio: string;
  tier: QualityTier;
  fps: number;
  status: JobStatus;
  /** 0-100 while rendering. */
  progress: number;
  /** Set once done: the file, ready to download. */
  result?: { url: string; fileName: string; bytes: number };
}

let counter = 0;

export function newJob(input: Pick<ExportJob, 'presetId' | 'aspectRatio' | 'tier' | 'fps'>): ExportJob {
  counter += 1;
  return { ...input, id: `job-${Date.now().toString(36)}-${counter}`, status: 'queued', progress: 0 };
}

/**
 * Adds a job, unless an identical one is still waiting -- two clicks on "Add"
 * are one intention, and rendering the same file twice helps nobody.
 */
export function addJob(jobs: ExportJob[], job: ExportJob): ExportJob[] {
  const duplicate = jobs.some(
    other =>
      other.status === 'queued' &&
      other.presetId === job.presetId &&
      other.tier === job.tier &&
      other.fps === job.fps
  );
  return duplicate ? jobs : [...jobs, job];
}

/** Removes a job that has not started. A running job is cancelled, not removed. */
export function removeJob(jobs: ExportJob[], id: string): ExportJob[] {
  return jobs.filter(job => job.id !== id || job.status === 'rendering');
}

/**
 * Moves a waiting job one place earlier (-1) or later (+1).
 *
 * Only among the waiting jobs: what has run has run, and the running one is
 * not reordered out from under itself.
 */
export function moveJob(jobs: ExportJob[], id: string, direction: -1 | 1): ExportJob[] {
  const waiting = jobs.filter(job => job.status === 'queued');
  const at = waiting.findIndex(job => job.id === id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= waiting.length) return jobs;
  const reordered = [...waiting];
  [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
  let next = 0;
  return jobs.map(job => (job.status === 'queued' ? reordered[next++] : job));
}

/** The next job to run, or undefined when none is waiting. */
export const nextJob = (jobs: ExportJob[]): ExportJob | undefined => jobs.find(job => job.status === 'queued');

export function updateJob(jobs: ExportJob[], id: string, change: Partial<ExportJob>): ExportJob[] {
  return jobs.map(job => (job.id === id ? { ...job, ...change } : job));
}

/** Stops the queue: the running job and everything after it are marked cancelled. */
export function cancelAll(jobs: ExportJob[]): ExportJob[] {
  return jobs.map(job =>
    job.status === 'queued' || job.status === 'rendering' ? { ...job, status: 'cancelled', progress: 0 } : job
  );
}

/** Whether a job is rendering right now. */
export const queueBusy = (jobs: ExportJob[]): boolean =>
  jobs.some(job => job.status === 'rendering');

/**
 * `Al-Fatihah_1_1-7.mp4` -> `Al-Fatihah_1_1-7_9x16.mp4`, so three platforms'
 * files from one queue do not all download under the same name.
 */
export function withAspect(fileName: string, aspectRatio: string): string {
  const tag = aspectRatio.replace(':', 'x');
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? `${fileName.slice(0, dot)}_${tag}${fileName.slice(dot)}` : `${fileName}_${tag}`;
}
