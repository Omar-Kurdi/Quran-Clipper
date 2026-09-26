'use client';

import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, HelpCircle, Loader2, ScanSearch } from 'lucide-react';
import { checkRender, type RenderCheckInput } from '@/lib/renderCheckRunner';
import type { CheckItem } from '@/lib/renderCheck';
import type { Dictionary } from '@/lib/i18n.en';
import { useT } from './LocaleProvider';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;

const ICONS = {
  ok: <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" aria-hidden />,
  problem: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" aria-hidden />,
  unsure: <HelpCircle className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden />,
};

/** One result, as a sentence. */
function describe(item: CheckItem, words: Dictionary['renderCheck']): string {
  if (item.state === 'unsure') return words.unsure[item.id];
  if (item.id === 'background') {
    if (item.state === 'ok') return words.backgroundOk;
    return (item.spans ?? [])
      .map(span => (span.kind === 'missing' ? words.backgroundMissing : words.backgroundStill)(clock(span.start), clock(span.end)))
      .join(' ');
  }
  const measured = clock(item.measured ?? 0);
  if (item.state === 'ok') return words.ok[item.id](measured);
  return words.problem[item.id](measured, clock(item.expected ?? 0));
}

/**
 * Checks the file that was just made against what was asked for: its length,
 * where its audio starts and ends in the recording, and whether the
 * background is there and moving throughout. On a click, because it reads the
 * whole file.
 */
export const RenderCheckPanel: React.FC<{ url: string; blob: Blob; input: RenderCheckInput }> = ({ url, blob, input }) => {
  const t = useT();
  const [items, setItems] = useState<CheckItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setRunning(true);
    setFailed(false);
    try {
      setItems(await checkRender(url, blob, input));
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="w-full text-start">
      {!items ? (
        <button
          onClick={run}
          disabled={running}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-100 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5 text-amber-400" />}
          <span>{running ? t.renderCheck.running : t.renderCheck.button}</span>
        </button>
      ) : (
        <ul role="status" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 space-y-1 text-[11px] leading-relaxed text-slate-300">
          {items.map(item => (
            <li key={item.id} className="flex items-start gap-1.5">
              <span className="mt-0.5">{ICONS[item.state]}</span>
              <span>{describe(item, t.renderCheck)}</span>
            </li>
          ))}
        </ul>
      )}
      {failed && <p role="alert" className="mt-1.5 text-[11px] text-amber-300/90">{t.renderCheck.failed}</p>}
    </div>
  );
};
