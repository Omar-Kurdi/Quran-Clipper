'use client';

import React, { useMemo, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { useT } from './LocaleProvider';
import { formatDuration } from './AudioTrimModal';

interface ClipsPanelProps {
  /** In the order they play, which is the order they are numbered in. */
  clips: { id: string; start: number; end: number; label: string; own: boolean }[];
  activeId: string | null;
  /** The recording's captions, for choosing a clip by its ayahs. */
  captions: { verseKey: string }[];
  onOpen: (id: string | null) => void;
  onRemove: (id: string) => void;
  /** Gives the open clip a look of its own, or the shared one back. */
  onOwnLook: (on: boolean) => void;
  /** A clip from the caption `first` to the caption `last`, by their places in `captions`. */
  onAddByAyahs: (first: number, last: number) => void;
}

type ListedClip = ClipsPanelProps['clips'][number];

/** One clip in the list: its ayahs and times, and opening, styling and removing it. */
const ClipRow: React.FC<{
  clip: ListedClip; name: string; open: boolean;
  onOpen: (id: string | null) => void; onRemove: (id: string) => void; onOwnLook: (on: boolean) => void;
}> = ({ clip, name, open, onOpen, onRemove, onOwnLook }) => {
  const t = useT();
  return (
    <li className={`px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 ${open ? 'bg-gold/10' : ''}`}>
      <span className="text-xs font-semibold text-slate-100">{name}</span>
      {clip.label && <span className="font-mono text-xs text-gold" dir="ltr">{clip.label}</span>}
      <span className="font-mono text-[11px] text-slate-400" dir="ltr">
        {formatDuration(clip.start)}–{formatDuration(clip.end)} · {formatDuration(clip.end - clip.start)}
      </span>
      <span className="ms-auto flex items-center gap-2">
        {open ? (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none" title={t.clips.ownLookTitle}>
            <input type="checkbox" checked={clip.own} onChange={e => onOwnLook(e.target.checked)} className="w-3.5 h-3.5 accent-amber-500" />
            {t.clips.ownLook}
          </label>
        ) : (
          clip.own && <span className="text-[11px] text-slate-400">{t.clips.ownLook}</span>
        )}
        <Button size="sm" variant={open ? 'ghost' : 'secondary'} onClick={() => onOpen(open ? null : clip.id)} title={t.clips.openTitle(name)}>
          {open ? t.clips.isOpen : t.clips.open}
        </Button>
        <button
          onClick={() => onRemove(clip.id)}
          aria-label={t.clips.remove(name)}
          title={t.clips.remove(name)}
          className="p-1 text-slate-400 hover:text-red-300 rounded"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </span>
    </li>
  );
};

/** Each ayah once, in the order heard, with the first and last of its captions. */
function listAyahs(captions: { verseKey: string }[]) {
  const listed: { key: string; first: number; last: number }[] = [];
  captions.forEach((caption, i) => {
    const seen = listed.find(ayah => ayah.key === caption.verseKey);
    if (seen) seen.last = i;
    else listed.push({ key: caption.verseKey, first: i, last: i });
  });
  return listed;
}

/** A clip made by naming its first and last ayah. */
const AyahPicker: React.FC<Pick<ClipsPanelProps, 'captions' | 'onAddByAyahs'>> = ({ captions, onAddByAyahs }) => {
  const t = useT();
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const ayahs = useMemo(() => listAyahs(captions), [captions]);
  const last = Math.max(0, ayahs.length - 1);
  // The list can shrink under the choice -- a re-match, a merge -- so it is read inside it.
  const first = Math.min(from, last);
  const final = Math.min(to, last);
  if (ayahs.length === 0) return null;
  const choice = (label: string, value: number, set: (index: number) => void) => (
    <label className="flex flex-col gap-1 text-[11px] text-slate-400">
      {label}
      <select value={value} onChange={e => set(Number(e.target.value))} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100" dir="ltr">
        {ayahs.map((ayah, i) => <option key={ayah.key} value={i}>{ayah.key}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset className="flex flex-wrap items-end gap-2">
      <legend className="mb-1 text-xs font-semibold text-slate-300">{t.clips.byAyahs}</legend>
      {choice(t.clips.from, first, setFrom)}
      {choice(t.clips.to, final, setTo)}
      <Button icon={<Plus className="w-3.5 h-3.5 text-amber-400" />} onClick={() => {
        const [a, b] = first <= final ? [ayahs[first], ayahs[final]] : [ayahs[final], ayahs[first]];
        onAddByAyahs(a.first, b.last);
      }}>
        {t.clips.add}
      </Button>
    </fieldset>
  );
};

/**
 * The clips cut from an uploaded recording (`recordingClips.ts`): each one a
 * stretch of the recording to open, style and export on its own.
 *
 * Under the clip's summary in Source, where the recording is described. The
 * timeline draws the same clips on a lane and makes new ones from its handles;
 * this is the list, and the way to make one by naming its ayahs.
 */
export const ClipsPanel: React.FC<ClipsPanelProps> = ({
  clips, activeId, captions, onOpen, onRemove, onOwnLook, onAddByAyahs
}) => {
  const t = useT();
  return (
    <section aria-label={t.clips.title} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-amber-400" aria-hidden="true" />
          {t.clips.title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{clips.length ? t.clips.intro : t.clips.empty}</p>
      </div>

      {clips.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
          <li>
            <button
              onClick={() => onOpen(null)}
              aria-pressed={activeId === null}
              className={`w-full px-3 py-2 text-start text-xs font-semibold transition-colors ${
                activeId === null ? 'bg-gold/10 text-gold' : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              {t.clips.wholeRecording}
            </button>
          </li>
          {clips.map((clip, i) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              name={t.clips.name(i + 1)}
              open={clip.id === activeId}
              onOpen={onOpen}
              onRemove={onRemove}
              onOwnLook={onOwnLook}
            />
          ))}
        </ul>
      )}

      <AyahPicker captions={captions} onAddByAyahs={onAddByAyahs} />

      {clips.length > 0 && <p className="text-[11px] leading-relaxed text-slate-400">{t.clips.editAudioOff}</p>}
    </section>
  );
};
