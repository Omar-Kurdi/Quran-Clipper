'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, Download, Loader2, Server, Trash2, X } from 'lucide-react';
import { formatBytes } from '@/lib/exportPresets';
import { isActive, type RenderJob } from '@/lib/serverRender';
import { useT } from './LocaleProvider';

interface ServerRendersPanelProps {
  jobs: RenderJob[];
  onDiscard: (id: string) => void;
}

/**
 * Renders running on the studio's server, and the files they made.
 *
 * Unlike the queue above it, nothing here depends on this tab: a render sent
 * from here carries on if the tab closes, and is listed again, file and all,
 * whenever the export dialog is next opened.
 */
export const ServerRendersPanel: React.FC<ServerRendersPanelProps> = ({ jobs, onDiscard }) => {
  const t = useT();
  if (!jobs.length) return null;
  return (
    <section aria-label={t.serverRender.label} className="mb-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
        <Server className="w-3.5 h-3.5 text-amber-400" />
        {t.serverRender.heading(jobs.length)}
      </h3>
      <ol className="mt-2 flex flex-col gap-1.5">
        {jobs.map(job => <RenderRow key={job.id} job={job} onDiscard={() => onDiscard(job.id)} />)}
      </ol>
      {jobs.some(isActive) && <p className="mt-2 text-[11px] text-slate-400">{t.serverRender.note}</p>}
    </section>
  );
};

function RenderRow({ job, onDiscard }: { job: RenderJob; onDiscard: () => void }) {
  const t = useT();
  const active = isActive(job);
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <RenderIcon job={job} />
        <span className="flex-1 min-w-0">
          <span className="block truncate text-slate-200" title={job.fileName}>{job.fileName}</span>
          <span className="block truncate text-slate-400" title={job.error}>
            {job.width}×{job.height} · {job.fps}fps · <RenderStatusText job={job} />
          </span>
        </span>
        {job.status === 'done' && (
          <a
            href={`/api/render?id=${job.id}`}
            download={job.fileName}
            className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/25"
          >
            <Download className="w-3 h-3" />
            {job.bytes ? formatBytes(job.bytes) : ''}
          </a>
        )}
        <button
          onClick={onDiscard}
          aria-label={active ? t.serverRender.cancel : t.serverRender.remove}
          title={active ? t.serverRender.cancel : t.serverRender.remove}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          {active ? <X className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
        </button>
      </div>
      {job.status === 'rendering' && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${job.progress}%` }} />
        </div>
      )}
    </li>
  );
}

function RenderStatusText({ job }: { job: RenderJob }) {
  const t = useT();
  switch (job.status) {
    case 'queued': return <>{t.serverRender.queued}</>;
    case 'rendering': return <>{t.serverRender.rendering(job.progress)}</>;
    case 'finishing': return <>{t.serverRender.finishing}</>;
    case 'failed': return <span className="text-red-300">{t.serverRender.failed}{job.error ? ` · ${job.error}` : ''}</span>;
    case 'cancelled': return <>{t.serverRender.cancelled}</>;
    default: return <>{formatSeconds(job.durationSec)}</>;
  }
}

function formatSeconds(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function RenderIcon({ job }: { job: RenderJob }) {
  if (job.status === 'rendering' || job.status === 'finishing') {
    return <Loader2 className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" />;
  }
  if (job.status === 'done') return <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />;
  if (job.status === 'failed') return <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />;
  return <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-slate-600" />;
}
