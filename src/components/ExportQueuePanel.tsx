'use client';

import React from 'react';
import { ArrowDown, ArrowUp, CheckCircle, Download, ListOrdered, Loader2, X } from 'lucide-react';
import { formatBytes } from '@/lib/exportPresets';
import type { ExportJob } from '@/lib/exportQueue';
import { useT } from './LocaleProvider';

interface ExportQueuePanelProps {
  jobs: ExportJob[];
  running: boolean;
  /** "Instagram Reels · High · 30fps" for a job. */
  describe: (job: ExportJob) => string;
  onRun: () => void;
  onCancel: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onClearFinished: () => void;
}

/**
 * The export queue: what is waiting, what is rendering, and what is ready.
 *
 * Waiting jobs can be reordered and removed; the running one can only be
 * cancelled, which stops the queue. Finished files stay here to download
 * until the list is cleared -- a browser allows one automatic download per
 * click, so a queue that tried to save every file by itself would lose all
 * but the first.
 */
export const ExportQueuePanel: React.FC<ExportQueuePanelProps> = ({
  jobs, running, describe, onRun, onCancel, onRemove, onMove, onClearFinished
}) => {
  const t = useT();
  if (!jobs.length) return null;
  const waiting = jobs.filter(job => job.status === 'queued');
  const finished = jobs.some(job => job.status === 'done' || job.status === 'cancelled' || job.status === 'failed');

  return (
    <section aria-label={t.exportQueue.label} className="mb-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
        <ListOrdered className="w-3.5 h-3.5 text-amber-400" />
        {t.exportQueue.heading(jobs.length)}
      </h3>
      <ol className="mt-2 flex flex-col gap-1.5">
        {jobs.map(job => (
          <JobRow
            key={job.id}
            job={job}
            label={describe(job)}
            movable={job.status === 'queued' && !running}
            first={waiting[0]?.id === job.id}
            last={waiting.at(-1)?.id === job.id}
            onMove={direction => onMove(job.id, direction)}
            onRemove={() => onRemove(job.id)}
          />
        ))}
      </ol>
      {running && <p className="mt-2 text-[11px] text-amber-300/90">{t.exportQueue.keepOpen}</p>}
      <QueueActions
        running={running}
        waiting={waiting.length}
        finished={finished}
        onRun={onRun}
        onCancel={onCancel}
        onClearFinished={onClearFinished}
      />
    </section>
  );
};

function QueueActions({
  running, waiting, finished, onRun, onCancel, onClearFinished
}: {
  running: boolean;
  waiting: number;
  finished: boolean;
  onRun: () => void;
  onCancel: () => void;
  onClearFinished: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-2 flex gap-2">
      {running ? (
        <button onClick={onCancel} className="flex-1 rounded-lg border border-red-500/40 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10">
          {t.exportQueue.cancel}
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={!waiting}
          className="flex-1 rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {t.exportQueue.run(waiting)}
        </button>
      )}
      {finished && !running && (
        <button onClick={onClearFinished} className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
          {t.exportQueue.clear}
        </button>
      )}
    </div>
  );
}

function JobRow({
  job, label, movable, first, last, onMove, onRemove
}: {
  job: ExportJob;
  label: string;
  movable: boolean;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <JobIcon job={job} />
        <span className="flex-1 min-w-0 truncate text-slate-200">{label}</span>
        {movable && (
          <>
            <IconButton label={t.exportQueue.moveUp} onClick={() => onMove(-1)} disabled={first}>
              <ArrowUp className="w-3 h-3" />
            </IconButton>
            <IconButton label={t.exportQueue.moveDown} onClick={() => onMove(1)} disabled={last}>
              <ArrowDown className="w-3 h-3" />
            </IconButton>
          </>
        )}
        {job.status === 'queued' && (
          <IconButton label={t.exportQueue.remove} onClick={onRemove}>
            <X className="w-3 h-3" />
          </IconButton>
        )}
        {job.status === 'done' && job.result && <DownloadLink result={job.result} />}
        {job.status === 'cancelled' && <span className="text-slate-400">{t.exportQueue.cancelled}</span>}
      </div>
      {job.status === 'rendering' && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${job.progress}%` }} />
        </div>
      )}
    </li>
  );
}

/** A finished file, saved under its own name. */
function DownloadLink({ result }: { result: NonNullable<ExportJob['result']> }) {
  return (
    <a
      href={result.url}
      download={result.fileName}
      className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/25"
    >
      <Download className="w-3 h-3" />
      {formatBytes(result.bytes)}
    </a>
  );
}

function JobIcon({ job }: { job: ExportJob }) {
  if (job.status === 'rendering') return <Loader2 className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" />;
  if (job.status === 'done') return <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />;
  return <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-slate-600" />;
}

function IconButton({
  label, onClick, disabled, children
}: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
