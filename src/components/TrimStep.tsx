'use client';

import React from 'react';
import { Scissors } from 'lucide-react';
import { Button } from './Button';
import { useT } from './LocaleProvider';

/**
 * The optional step between choosing a recording and matching it: cut what
 * is not recitation off either end.
 *
 * It was a small button beside "Time it by hand", under Match, so people
 * matched whole downloads -- an intro, talk, a minute of silence -- and only
 * found the trim afterwards. Shown as its own step, in the order the work
 * goes, with the file's length so it is plain how much there is to cut.
 */
export const TrimStep: React.FC<{ length: string; onTrim: () => void; disabled?: boolean }> = ({ length, onTrim, disabled }) => {
  const t = useT();
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-3">
      <Scissors className="w-5 h-5 mt-0.5 text-amber-400" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-100">
          {t.source.trimStepTitle}
          {length && <span className="ms-2 text-xs font-mono font-normal text-slate-400" dir="ltr">{length}</span>}
        </p>
        <p className="text-xs leading-relaxed text-slate-400">{t.source.trimStepBody}</p>
      </div>
      <Button onClick={onTrim} disabled={disabled} className="shrink-0 self-center">
        {t.source.trimStepButton}
      </Button>
    </div>
  );
};
