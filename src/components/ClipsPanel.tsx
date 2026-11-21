'use client';

import React, { useMemo, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { Button } from './Button';
import { useT } from './LocaleProvider';

interface ClipsPanelProps {
  /** The recording's captions, for choosing a clip by its ayahs. */
  captions: { verseKey: string; startTime: number; endTime: number }[];
  /** A clip from the caption `first` to the caption `last`, by their places in `captions`. */
  onAddByAyahs: (first: number, last: number) => void;
}

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
 * Making a clip of an uploaded recording by naming its ayahs: each clip is a
 * project of its own (`makeClipProject`), listed under the recording in
 * Projects. The timeline makes the same from a dragged stretch.
 */
export const ClipsPanel: React.FC<ClipsPanelProps> = ({ captions, onAddByAyahs }) => {
  const t = useT();
  return (
    <section aria-label={t.clips.title} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-amber-400" aria-hidden="true" />
          {t.clips.title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.clips.intro}</p>
      </div>
      <AyahPicker captions={captions} onAddByAyahs={onAddByAyahs} />
    </section>
  );
};
