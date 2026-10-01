'use client';

import React from 'react';
import type { ScreenBreaks } from '@/lib/forcedAligner';
import { useT } from './LocaleProvider';

const LEVELS: ScreenBreaks[] = ['fewer', 'normal', 'more'];

/**
 * Fewer / Normal / More on a matched recording's summary, applied at once.
 *
 * The same setting as the one under Advanced, so the two never disagree; here
 * it re-cuts the match on screen rather than waiting for the next one. When
 * the captions have been edited since, it asks first: a re-cut replaces them,
 * and although Ctrl+Z brings them back, losing work should not be the
 * surprise.
 */
export const ScreenBreaksRecut: React.FC<{
  value: ScreenBreaks;
  busy: boolean;
  /** The level waiting on a yes, when the captions have been edited. */
  confirming: ScreenBreaks | null;
  onChoose: (level: ScreenBreaks) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ value, busy, confirming, onChoose, onConfirm, onCancel }) => {
  const t = useT();
  const name = (level: ScreenBreaks) =>
    level === 'fewer' ? t.source.screenBreaksFewer : level === 'more' ? t.source.screenBreaksMore : t.source.screenBreaksNormal;
  return (
    <fieldset className="min-w-0" aria-busy={busy}>
      <legend className="text-xs font-semibold text-slate-400 block mb-1">{t.source.screenBreaksLabel}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {LEVELS.map(level => (
          <button
            key={level}
            type="button"
            aria-pressed={value === level}
            disabled={busy}
            onClick={() => onChoose(level)}
            className={`py-1.5 rounded-md border text-center text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60 ${
              value === level
                ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            {name(level)}
          </button>
        ))}
      </div>
      {confirming ? (
        <div role="alert" className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200 flex flex-col gap-2">
          <span>{t.source.recutReplacesEdits(name(confirming))}</span>
          <span className="flex gap-2">
            <button type="button" onClick={onConfirm} className="h-7 px-3 rounded-md bg-amber-500 text-slate-950 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              {t.source.recut}
            </button>
            <button type="button" onClick={onCancel} className="h-7 px-3 rounded-md border border-slate-700 text-slate-200 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              {t.source.recutCancel}
            </button>
          </span>
        </div>
      ) : (
        <p className="text-xs text-slate-400 mt-1">{busy ? t.source.recutting : t.source.recutHelp}</p>
      )}
    </fieldset>
  );
};
