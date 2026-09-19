'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportHealth } from '@/lib/exportHealth';
import { planExport, presetById, type ExportPlan, type QualityTier } from '@/lib/exportPresets';
import {
  addJob, cancelAll, moveJob, newJob, nextJob, queueBusy, removeJob, updateJob, withAspect,
  type ExportJob
} from '@/lib/exportQueue';

interface QueueDeps {
  /** The studio's current shape. A job for another shape switches it first. */
  aspectRatio: string;
  onAspectRatio: (aspectRatio: string) => void;
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
    const fileName = withAspect(fileNameFor(blob), job.aspectRatio);
    onSaveExportRecord({ fileName, fileSizeBytes: blob.size, durationSec: exportSeconds, renderMs });
    const result = { url: URL.createObjectURL(blob), fileName, bytes: blob.size };
    setJobs(current => updateJob(current, job.id, { status: 'done', progress: 100, result }));
  });
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
  const shapeBefore = useRef<string | null>(null);
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const finish = useCallback(() => {
    setRunning(false);
    if (shapeBefore.current && shapeBefore.current !== latest.current.aspectRatio) {
      latest.current.onAspectRatio(shapeBefore.current);
    }
    shapeBefore.current = null;
  }, []);

  const runJob = useCallback((job: ExportJob) => startJob(job, latest, setJobs), [setJobs]);

  useEffect(() => {
    if (!running || deps.isExporting || queueBusy(jobs)) return;
    const job = nextJob(jobs);
    if (job && deps.aspectRatio !== job.aspectRatio) {
      deps.onAspectRatio(job.aspectRatio);
      return;
    }
    // Timers rather than animation frames: a queue is exactly what someone
    // leaves running in a background tab, where frames stop being delivered.
    // The delay is a beat for the canvas to have committed its new shape.
    const timer = window.setTimeout(() => (job ? runJob(job) : finish()), job ? 100 : 0);
    return () => window.clearTimeout(timer);
    // `deps.onAspectRatio` is read fresh; the rest is what decides whether to start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, jobs, deps.isExporting, deps.aspectRatio, runJob, finish]);

  return {
    running,
    finish,
    start: () => {
      shapeBefore.current = deps.aspectRatio;
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
