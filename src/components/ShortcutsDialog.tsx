'use client';

import React from 'react';
import { Keyboard } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useT } from './LocaleProvider';

interface ShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** One key, drawn as a key. Always left-to-right: `Ctrl + Z` reads that way in any language. */
const Keys: React.FC<{ combo: string }> = ({ combo }) => (
  <span dir="ltr" className="flex items-center gap-1 shrink-0">
    {combo.split('+').map((key, i) => (
      <React.Fragment key={key}>
        {i > 0 && <span className="text-slate-500 text-[10px]">+</span>}
        <kbd className="min-w-7 px-1.5 py-1 rounded-md bg-slate-950 border border-slate-700 border-b-2 text-[11px] font-mono text-slate-200 text-center">
          {key.trim()}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

/**
 * What the keyboard does here.
 *
 * The studio has had shortcuts since it had a transport, and nothing in the
 * interface said so: B in particular -- the fastest way to cut a boundary by
 * ear -- was findable only by reading the source or a tooltip on one button.
 * Opened with `?`, which is what the list itself tells you.
 *
 * The rows are the shortcuts, not a description of them: anything added to
 * `useTransportKeys` belongs here in the same commit.
 */
export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const rows: [string, string][] = [
    ['Space', t.shortcuts.playPause],
    ['B', t.shortcuts.markEnd],
    ['Ctrl + Z', t.shortcuts.undo],
    ['Ctrl + Shift + Z', t.shortcuts.redo],
    ['?', t.shortcuts.list],
    ['Esc', t.shortcuts.dismiss]
  ];

  return (
    <Dialog isOpen={isOpen} onClose={onClose} label={t.shortcuts.dialogLabel} panelClassName="max-w-lg w-full">
      <div className="w-[min(30rem,92vw)] bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="p-2 bg-amber-500/15 text-amber-400 rounded-xl border border-amber-500/25 shrink-0">
            <Keyboard className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100">{t.shortcuts.title}</h3>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{t.shortcuts.hint}</p>
          </div>
        </div>

        <ul className="flex flex-col gap-1 mt-4">
          {rows.map(([combo, what]) => (
            <li
              key={combo}
              className="flex items-center gap-3 justify-between rounded-lg bg-slate-950/60 border border-slate-800 px-2.5 py-2"
            >
              <span className="text-xs text-slate-200 min-w-0">{what}</span>
              <Keys combo={combo} />
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-slate-400 mt-3">{t.shortcuts.macNote}</p>

        <div className="flex justify-end mt-4">
          <Button size="md" onClick={onClose}>{t.common.close}</Button>
        </div>
      </div>
    </Dialog>
  );
};
