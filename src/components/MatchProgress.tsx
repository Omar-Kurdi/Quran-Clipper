'use client';

import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useT } from './LocaleProvider';
import { matchView, type MatchRun, type Step, type StepId } from '@/lib/matchSteps';
import type { Dictionary } from '@/lib/i18n.en';

type StepLabels = Dictionary['match']['steps'];

/** What each step is called, with its count or place when it has one. */
const LABELS: Record<StepId, (labels: StepLabels, step: Step) => string> = {
  read: labels => labels.read,
  queue: (labels, step) => labels.queue(step.position ?? 1, step.wait ?? null),
  listen: (labels, step) => (step.count ? labels.listenOf(step.count.done, step.count.total) : labels.listen),
  find: labels => labels.find,
  align: (labels, step) => (step.count ? labels.alignOf(step.count.done, step.count.total) : labels.align),
  retime: labels => labels.retime,
  longRead: labels => labels.longRead,
  split: (labels, step) => (step.count ? labels.splitInto(step.count.total) : labels.split),
  parts: (labels, step) => (step.count ? labels.partOf(step.count.done, step.count.total) : labels.parts),
};

const TONE = { done: 'text-slate-400', current: 'text-slate-100', pending: 'text-slate-500' } as const;

/** A step's mark: ticked when done, turning while under way, a dot while to come. */
function StepMark({ state }: { state: Step['state'] }) {
  if (state === 'done') return <Check aria-hidden className="w-3.5 h-3.5 shrink-0 text-emerald-400" />;
  if (state === 'current') return <Loader2 aria-hidden className="w-3.5 h-3.5 shrink-0 text-blue-400 animate-spin" />;
  return <span aria-hidden className="w-3.5 h-3.5 shrink-0 flex items-center justify-center"><span className="w-1 h-1 rounded-full bg-slate-600" /></span>;
}

/**
 * A match under way, said at a glance: how far along it is, as a bar and a
 * share, and its steps -- the ones done ticked, the one under way turning,
 * the ones to come dimmed. Only what is known is said (`matchSteps.ts`).
 */
export const MatchProgress: React.FC<{ run: MatchRun }> = ({ run }) => {
  const t = useT();
  const view = matchView(run);
  // Never back: a part's own stages restart where the last left off, but the whole only goes on.
  const [furthest, setFurthest] = useState(0);
  if (view.fraction > furthest) setFurthest(view.fraction);
  const percent = Math.round(Math.max(furthest, view.fraction) * 100);
  const label = (step: Step) => LABELS[step.id](t.match.steps, step);
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold text-slate-100">
          {run.phase === 'longRead' ? t.match.progressReading : t.match.progressTitle}
        </span>
        <span className="font-mono text-xs text-slate-300" dir="ltr">{percent}%</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-blue-400 transition-[width] duration-500" style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      <ol className="flex flex-col gap-1 text-xs">
        {view.steps.map(step => (
          <li key={step.id} className="flex flex-col">
            <span className={`flex items-center gap-2 ${TONE[step.state]}`}>
              <StepMark state={step.state} />
              {label(step)}
            </span>
            {step.id === 'parts' && step.state === 'current' && view.inner && (
              <span className="ms-5.5 text-slate-400">{label(view.inner)}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
};
