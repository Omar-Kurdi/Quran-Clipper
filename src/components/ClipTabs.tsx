'use client';

import React, { useState } from 'react';
import { Check, Layers, Plus, X } from 'lucide-react';
import { clipColour } from '@/lib/clipColours';
import { ConfirmDialog } from './ConfirmDialog';
import { useT } from './LocaleProvider';

interface ClipTabsProps {
  /** In the order they play, which is the order they are numbered in. */
  clips: { id: string; label: string }[];
  activeId: string | null;
  /** The clips with an export on record, which their tab marks done. */
  exported?: ReadonlySet<string>;
  onOpen: (id: string | null) => void;
  onRemove: (id: string) => void;
  /** Starts the next clip: the whole recording, to choose its stretch on the timeline. */
  onNew: () => void;
}

const tabClass = (on: boolean) =>
  `relative h-14 shrink-0 flex items-center gap-1.5 px-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 ${
    on ? 'border-amber-500 text-slate-100 bg-gradient-to-t from-amber-500/10 to-transparent' : 'border-transparent text-slate-400 hover:text-slate-200'
  }`;

/**
 * The recording's clips as tabs in the studio's top bar, after Video-Clipper's
 * shorts: the whole recording first, then each clip in its own colour, named
 * by its ayahs while open and marked once exported, and *New clip* last.
 *
 * Each clip is a project of its own (`makeClipProject`), so opening a tab
 * opens that project, as its own page: its own audio, timeline, captions and
 * look. Deleting one deletes that project, after asking.
 */
export const ClipTabs: React.FC<ClipTabsProps> = ({ clips, activeId, exported, onOpen, onRemove, onNew }) => {
  const t = useT();
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  return (
    <nav aria-label={t.clips.tabsLabel} className="hidden md:flex items-stretch min-w-0 overflow-x-auto overflow-y-hidden -my-px">
      <button type="button" onClick={() => onOpen(null)} aria-current={activeId === null ? 'page' : undefined}
        title={t.clips.wholeRecordingTitle} className={tabClass(activeId === null)}>
        <Layers className="w-3.5 h-3.5" aria-hidden="true" />
        {t.clips.whole}
      </button>
      {clips.map((clip, i) => {
        const on = clip.id === activeId;
        const name = t.clips.name(i + 1);
        const done = exported?.has(clip.id);
        return (
          <span key={clip.id} className={tabClass(on)}>
            <button type="button" onClick={() => onOpen(clip.id)} aria-current={on ? 'page' : undefined}
              title={t.clips.openTitle(name)} className="flex items-center gap-1.5 focus-visible:outline-none">
              <span className={`w-2 h-2 rounded-sm ${clipColour(i).dot}`} aria-hidden="true" />
              {name}
              {on && clip.label && <span className="font-mono font-normal text-[11px] text-gold" dir="ltr">{clip.label}</span>}
              {done && <Check className="w-3 h-3 text-emerald-400" aria-label={t.clips.exported} />}
            </button>
            <button type="button" onClick={() => setRemoving({ id: clip.id, name })}
              aria-label={t.clips.remove(name)} title={t.clips.remove(name)}
              className="ms-0.5 p-0.5 rounded text-slate-500 hover:text-red-300">
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
      <button type="button" onClick={onNew} title={t.clips.newTabTitle} className={`${tabClass(false)} !text-amber-400 hover:!text-amber-300`}>
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        {t.clips.newTab}
      </button>
      <ConfirmDialog
        isOpen={removing !== null}
        title={removing ? t.clips.remove(removing.name) : ''}
        message={t.clips.removeMessage}
        confirmLabel={t.clips.removeConfirm}
        onConfirm={() => { if (removing) onRemove(removing.id); setRemoving(null); }}
        onCancel={() => setRemoving(null)}
      />
    </nav>
  );
};
