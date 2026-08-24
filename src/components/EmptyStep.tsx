'use client';

import React from 'react';

interface EmptyStepProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * What a step shows before its prerequisite exists.
 *
 * Steps 2 and 3 previously rendered their full interface with nothing loaded --
 * offering to mark boundaries for ayahs that did not exist, and to style a
 * video with no verses in it. An empty screen is the best chance to explain the
 * order of the work, so this says why the step is empty and moves you to the
 * step that fills it, rather than just reporting that there is no data.
 */
export const EmptyStep: React.FC<EmptyStepProps> = ({ icon, title, body, actionLabel, onAction }) => (
  <div className="flex flex-col items-center text-center gap-3 px-5 py-10">
    <span className="p-3 rounded-xl bg-slate-800/70 border border-slate-700 text-amber-400">{icon}</span>
    <h3 className="font-display text-lg text-parchment leading-tight">{title}</h3>
    <p className="text-[11px] text-slate-400 leading-relaxed max-w-[34ch]">{body}</p>
    <button
      onClick={onAction}
      className="mt-1 px-3.5 py-2 bg-gold hover:bg-gold-bright text-ink text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
    >
      {actionLabel}
    </button>
  </div>
);
