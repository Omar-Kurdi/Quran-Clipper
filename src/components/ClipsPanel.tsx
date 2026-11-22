'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Play, Plus } from 'lucide-react';
import { Button } from './Button';
import { useT } from './LocaleProvider';
import { LengthReadout } from './LengthReadout';
import { formatDuration } from './AudioTrimModal';
import { SUGGESTION_TARGETS, suggestionId, suggestionLabel, type Suggestion } from '@/lib/clipSuggestions';

interface ClipsPanelProps {
  /** The recording's captions, for choosing a clip by its ayahs. */
  captions: { verseKey: string; startTime: number; endTime: number }[];
  /** A clip from the caption `first` to the caption `last`, by their places in `captions`. */
  onAddByAyahs: (first: number, last: number) => void;
  /** The ayahs already in a clip of the recording, by key. */
  clipped?: ReadonlySet<string>;
  /** The ayahs chosen so far, from caption `first` to caption `last`: shown on the timeline. */
  onPick?: (first: number, last: number) => void;
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

/**
 * The recording's ayahs as a grid, one cell per ayah in the order heard:
 * click one and shift-click another to choose the clip from the first to the
 * last, its length against each platform's limit beside it. Ayahs already in
 * a clip are marked; choosing shows the stretch on the timeline too.
 */
const AyahGrid: React.FC<Pick<ClipsPanelProps, 'captions' | 'onAddByAyahs' | 'clipped' | 'onPick'>> = ({ captions, onAddByAyahs, clipped, onPick }) => {
  const t = useT();
  const ayahs = useMemo(() => listAyahs(captions), [captions]);
  const [chosen, setChosen] = useState<{ anchor: number; from: number; to: number } | null>(null);
  // The list can shrink under the choice -- a re-match, a merge -- so it is read inside it.
  const range = chosen && chosen.to < ayahs.length ? chosen : null;
  if (ayahs.length === 0) return null;
  const choose = (i: number, extend: boolean) => {
    const anchor = extend && range ? range.anchor : i;
    const next = { anchor, from: Math.min(anchor, i), to: Math.max(anchor, i) };
    setChosen(next);
    onPick?.(ayahs[next.from].first, ayahs[next.to].last);
  };
  const seconds = range ? captions[ayahs[range.to].last].endTime - captions[ayahs[range.from].first].startTime : 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-slate-300">{t.clips.byAyahs}</p>
      <div role="group" aria-label={t.clips.byAyahs} className="grid grid-cols-[repeat(auto-fill,minmax(2.1rem,1fr))] gap-1 max-h-64 overflow-y-auto pe-1" dir="ltr">
        {ayahs.map((ayah, i) => {
          const on = !!range && i >= range.from && i <= range.to;
          // The basmala's key is a word, too long for a cell: it is shown as its first word.
          const number = ayah.key.split(':')[1] ?? 'بسم';
          return (
            <button key={ayah.key} type="button" onClick={e => choose(i, e.shiftKey)} aria-pressed={on} title={ayah.key}
              className={`h-7 rounded text-[11px] font-mono font-semibold border transition-colors ${
                on ? 'bg-gold text-ink border-gold'
                  : clipped?.has(ayah.key) ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40 hover:border-amber-400'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-400'
              }`}>
              {number}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">{t.clips.gridHint}</p>
      {range && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-gold" dir="ltr">
            {ayahs[range.from].key}{range.to > range.from ? `–${ayahs[range.to].key.split(':')[1]}` : ''}
          </span>
          <LengthReadout seconds={seconds} />
          <Button icon={<Plus className="w-3.5 h-3.5 text-amber-400" />} onClick={() => onAddByAyahs(ayahs[range.from].first, ayahs[range.to].last)}>
            {t.clips.makeAClip}
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * Making a clip of an uploaded recording by naming its ayahs: each clip is a
 * project of its own (`makeClipProject`), listed under the recording in
 * Projects. The timeline makes the same from a dragged stretch.
 */
export const ClipsPanel: React.FC<ClipsPanelProps> = ({ captions, onAddByAyahs, clipped, onPick }) => {
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
      <AyahGrid captions={captions} onAddByAyahs={onAddByAyahs} clipped={clipped} onPick={onPick} />
    </section>
  );
};

/**
 * A clip's start and end, each moved one whole ayah: earlier or later, on
 * its recording's map, its captions coming with it (`nudgedStretch`).
 */
export const ClipEnds: React.FC<{ onNudge: (edge: 'start' | 'end', by: -1 | 1) => void }> = ({ onNudge }) => {
  const t = useT();
  const nudge = (edge: 'start' | 'end', by: -1 | 1, label: string) => (
    <button type="button" onClick={() => onNudge(edge, by)} aria-label={label} title={label}
      className="p-1 rounded border border-slate-700 text-slate-200 hover:border-amber-400 hover:text-amber-300">
      {by < 0 ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </button>
  );
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-300" dir="ltr">
      <span className="flex items-center gap-1">{t.clips.startEnd}{nudge('start', -1, t.clips.startEarlier)}{nudge('start', 1, t.clips.startLater)}</span>
      <span className="flex items-center gap-1">{t.clips.endEnd}{nudge('end', -1, t.clips.endEarlier)}{nudge('end', 1, t.clips.endLater)}</span>
    </div>
  );
};

/**
 * Clips the app suggests from the recording's ayah map (`suggestClips`):
 * about as long as chosen, at most a three-minute Short, each to hear and
 * tick -- here or on the timeline, where they are drawn too; *Make N clips*
 * makes every one ticked, each a project of its own.
 */
export const SuggestedClips: React.FC<{
  suggestions: Suggestion[];
  target: number;
  onTarget: (seconds: number) => void;
  ticked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  clipped?: ReadonlySet<string>;
  onPreview: (start: number) => void;
  onMake: (stretches: Suggestion[]) => void;
}> = ({ suggestions, target, onTarget, ticked, onToggle, clipped, onPreview, onMake }) => {
  const t = useT();
  if (suggestions.length === 0) return null;
  const chosen = suggestions.filter(each => ticked.has(suggestionId(each)));
  return (
    <section aria-label={t.clips.suggested} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-slate-300 me-auto">{t.clips.suggested}</p>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {t.clips.about}
          <select value={target} onChange={e => onTarget(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100">
            {SUGGESTION_TARGETS.map(seconds => <option key={seconds} value={seconds}>{formatDuration(seconds)}</option>)}
          </select>
        </label>
      </div>
      <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800 max-h-72 overflow-y-auto">
        {suggestions.map(each => {
          const id = suggestionId(each);
          const inClip = !!clipped?.has(each.from) || !!clipped?.has(each.to);
          return (
            <li key={id} className="flex items-center gap-2 px-2.5 py-1.5">
              <input type="checkbox" checked={ticked.has(id)} onChange={() => onToggle(id)} aria-label={id} className="w-3.5 h-3.5 accent-amber-500" />
              <button type="button" onClick={() => onPreview(each.start)} title={t.clips.preview}
                className="p-1 rounded text-slate-300 hover:text-amber-300"><Play className="w-3.5 h-3.5" /></button>
              <span className="font-mono text-xs text-gold" dir="ltr">{suggestionLabel(each)}</span>
              <span className="font-mono text-[11px] text-slate-400" dir="ltr">{formatDuration(each.end - each.start)}</span>
              {inClip && <span className="ms-auto text-[10px] text-emerald-300">{t.clips.inAClip}</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!chosen.length} onClick={() => onMake(chosen)}>
          {t.clips.makeMany(chosen.length)}
        </Button>
        <span className="text-[11px] text-slate-400">{t.clips.suggestedHint}</span>
      </div>
    </section>
  );
};
