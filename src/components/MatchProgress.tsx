'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * A match under way, said at a glance: a spinner, how long it has run, a bar
 * -- filling when the parts are known, sweeping when they are not -- and one
 * short line of where it has got to.
 */
export const MatchProgress: React.FC<{
  title: string;
  step: string;
  progress?: { done: number; total: number } | null;
}> = ({ title, step, progress }) => {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - started) / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const share = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Loader2 aria-hidden className="w-4 h-4 shrink-0 text-blue-400 animate-spin" />
        <span className="flex-1 text-sm font-semibold text-slate-100">{title}</span>
        <span className="font-mono text-xs text-slate-400" dir="ltr">{elapsed}</span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress?.total || undefined}
        aria-valuenow={share === null ? undefined : progress!.done}
      >
        {share === null
          ? <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-blue-400 animate-progress-sweep" />
          : <span className="absolute inset-y-0 left-0 rounded-full bg-blue-400 transition-[width] duration-500" style={{ width: `${Math.max(4, share * 100)}%` }} />}
      </div>
      <p className="text-xs text-slate-300">{step}</p>
    </div>
  );
};
