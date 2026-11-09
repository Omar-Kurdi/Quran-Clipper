'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportHealth } from '@/lib/exportHealth';
import { planExport, presetById, type ExportPlan, type QualityTier } from '@/lib/exportPresets';
import {
  addJob, addJobs, cancelAll, moveJob, newJob, nextJob, queueBusy, removeJob, updateJob, withAspect, withClip,
  type ExportJob
} from '@/lib/exportQueue';

interface QueueDeps {
  /** The studio's current shape. A job for another shape switches it first. */
  aspectRatio: string;
  onAspectRatio: (aspectRatio: string) => void;
  /**
   * The clip of the recording that is open, and how to open another -- for a
   * job naming one. `keep: false` leaves the clips' looks as they were kept,
   * since the queue changes the frame's shape and that is no edit to a look.
   */
  clipId?: string | null;
  onClip?: (id: string | null, keep: boolean) => void;
  onStartExport: (
    plan: ExportPlan,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => void;
  onCancelExport: () => void;
  isExporting: boolean;
  /** Percent through the render that is running now. */
  exportProgress: number;
  exportSeconds: number;
  /** The file name a single render would get, for a blob of this type. */
  fileNameFor: (blob: Blob) => string;
  onSaveExportRecord: (record: { fileName: string; fileSizeBytes: number; durationSec: number; renderMs: number }) => void;
}

type SetJobs = React.Dispatch<React.SetStateAction<ExportJob[]>>;

/**
 * Starts one job through the export path and files its result when it lands.
 * Reads `latest` at each step, so a studio that changed meanwhile names the
 * file and records the render as it now is.
 */
function startJob(job: ExportJob, latest: React.RefObject<QueueDeps>, setJobs: SetJobs) {
  const { exportSeconds, onStartExport } = latest.current;
  setJobs(current => updateJob(current, job.id, { status: 'rendering', progress: 0 }));
  const plan = planExport({ presetId: job.presetId, tier: job.tier, fps: job.fps, seconds: exportSeconds });
  onStartExport(plan, (blob, renderMs) => {
    const { fileNameFor, onSaveExportRecord } = latest.current;
    const fileName = withClip(withAspect(fileNameFor(blob), job.aspectRatio), job.clipNumber);
    onSaveExportRecord({ fileName, fileSizeBytes: blob.size, durationSec: exportSeconds, renderMs });
    const result = { url: URL.createObjectURL(blob), fileName, bytes: blob.size };
    setJobs(current => updateJob(current, job.id, { status: 'done', progress: 100, result }));
  });
}

/** What was open in the studio before the queue started: its shape, and the clip when the queue opens clips. */
interface Before {
  shape: string | null;
  clip?: string | null;
}

/** Puts the studio back as it was. The clip first: opening it puts its look back, shape included. */
function restoreStudio(before: Before, deps: QueueDeps) {
  if (before.clip !== undefined && before.clip !== deps.clipId) deps.onClip?.(before.clip, false);
  if (before.shape && before.shape !== deps.aspectRatio) deps.onAspectRatio(before.shape);
}

/**
 * Switches the studio to what `job` renders, if it is not there yet; true
 * when it did, and the job has to wait for the studio to commit it. Its clip
 * before its shape: a clip with a look of its own has a shape of its own.
 */
function switchStudioFor(job: ExportJob, deps: QueueDeps): boolean {
  if (job.clipId !== undefined && job.clipId !== (deps.clipId ?? null)) {
    deps.onClip?.(job.clipId, false);
    return true;
  }
  if (deps.aspectRatio !== job.aspectRatio) {
    deps.onAspectRatio(job.aspectRatio);
    return true;
  }
  return false;
}

/**
 * The part that runs: starts the next job once nothing is rendering and the
 * studio is in its shape, and puts the shape back when the queue ends.
 *
 * A job for a different aspect ratio switches the studio to it and waits for
 * the canvas to have committed that shape before starting, because the
 * frame-by-frame encoder draws from the canvas's current config. When the
 * queue ends -- finished or cancelled -- the studio goes back to the shape it
 * was in, so running a queue does not quietly reformat the project.
 */
function useQueueRunner(deps: QueueDeps, jobs: ExportJob[], setJobs: SetJobs) {
  const [running, setRunning] = useState(false);
  const before = useRef<Before>({ shape: null });
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const finish = useCallback(() => {
    setRunning(false);
    restoreStudio(before.current, latest.current);
    before.current = { shape: null };
  }, []);

  const runJob = useCallback((job: ExportJob) => startJob(job, latest, setJobs), [setJobs]);

  useEffect(() => {
    if (!running || deps.isExporting || queueBusy(jobs)) return;
    const job = nextJob(jobs);
    if (job && switchStudioFor(job, deps)) return;
    // Timers rather than animation frames: a queue is exactly what someone
    // leaves running in a background tab, where frames stop being delivered.
    // The delay is a beat for the canvas to have committed its new shape.
    const timer = window.setTimeout(() => (job ? runJob(job) : finish()), job ? 100 : 0);
    return () => window.clearTimeout(timer);
    // The switches are read fresh; the rest is what decides whether to start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, jobs, deps.isExporting, deps.aspectRatio, deps.clipId, runJob, finish]);

  return {
    running,
    finish,
    start: () => {
      before.current = { shape: deps.aspectRatio, ...(deps.onClip ? { clip: deps.clipId ?? null } : {}) };
      // The looks as they stand now are the ones each clip renders with and comes back to.
      deps.onClip?.(deps.clipId ?? null, true);
      setRunning(true);
    }
  };
}

/** Runs `exportQueue` jobs one at a time through the modal's own export path. */
export function useExportQueue(deps: QueueDeps) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const runner = useQueueRunner(deps, jobs, setJobs);

  // The running job's progress comes from the one export in flight.
  const shownJobs = jobs.map(job => (job.status === 'rendering' ? { ...job, progress: deps.exportProgress } : job));

  return {
    jobs: shownJobs,
    running: runner.running,
    add: (input: { presetId: string; tier: QualityTier; fps: number }) =>
      setJobs(current => addJob(current, newJob({ ...input, aspectRatio: presetById(input.presetId).aspectRatio }))),
    remove: (id: string) =>
      setJobs(current => {
        const gone = current.find(job => job.id === id);
        if (gone?.result) URL.revokeObjectURL(gone.result.url);
        return removeJob(current, id);
      }),
    move: (id: string, direction: -1 | 1) => setJobs(current => moveJob(current, id, direction)),
    run: () => {
      if (nextJob(jobs)) runner.start();
    },
    /**
     * Queues these renders and starts the queue. The runner reacts to the
     * committed job list, so adding and starting in one go is safe here where
     * `run` -- which reads the list as it was -- would see nothing to run.
     */
    runAll: (inputs: { presetId: string; tier: QualityTier; fps: number; clipId?: string | null; clipLabel?: string; clipNumber?: number }[]) => {
      setJobs(current =>
        addJobs(current, inputs.map(input => ({ ...input, aspectRatio: presetById(input.presetId).aspectRatio })))
      );
      runner.start();
    },
    cancel: () => {
      if (queueBusy(jobs)) deps.onCancelExport();
      setJobs(cancelAll);
      runner.finish();
    },
    /** Finished and cancelled jobs out of the list; their files are released. */
    clearFinished: () =>
      setJobs(current => {
        for (const job of current) if (job.result) URL.revokeObjectURL(job.result.url);
        return current.filter(job => job.status === 'queued' || job.status === 'rendering');
      })
  };
}
