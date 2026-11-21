'use client';

import React, { useState } from 'react';
import { Plus, Scissors } from 'lucide-react';
import { formatDuration, parseTimecode } from '@/lib/timecode';
import { useT } from './LocaleProvider';

interface ClipSelectionBarProps {
  /** The stretch selected, on the timeline's clock (seconds from `origin`). */
  start: number;
  end: number;
  /** Where the clock reads 0:00: a built-in reciter's passage start, 0 for an upload. */
  origin: number;
  /** The ayahs inside it, as `2:201–203`, or '' when it holds none. */
  label: string;
  /** The recording's ayahs, as `2:201`, in the order heard, and the first and last of them it holds. */
  ayahs?: string[];
  held?: { from: string; to: string } | null;
  /** Chosen by ayahs: from the first to the last, opened and closed on the pauses. */
  onAyahs?: (from: string, to: string) => void;
  snap: boolean;
  onSnap: (on: boolean) => void;
  /** A typed start or end. */
  onRange: (start: number, end: number) => void;
  /** Make it a clip, the button saying `makeText`. */
  makeText?: string;
  onMake?: () => void;
  /** Cut the recording down to it, where there are no clips to make. */
  keepLabel?: string;
  onKeep?: () => void;
  onReset: () => void;
}

/** One end of the stretch, typed as h:mm:ss.s, m:ss.s or seconds; committed on Enter or on leaving the field. */
const TimeField: React.FC<{ value: number; label: string; onCommit: (seconds: number) => void }> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const parsed = draft === null ? null : parseTimecode(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };
  return (
    <input
      value={draft ?? formatDuration(value)}
      onFocus={e => { setDraft(formatDuration(value)); e.currentTarget.select(); }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      aria-label={label}
      dir="ltr"
      spellCheck={false}
      className="w-[5.5rem] bg-transparent font-mono text-xs font-semibold text-amber-300 text-center rounded px-1 py-0.5 hover:bg-slate-800 focus:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
    />
  );
};

/**
 * The stretch as its first and last ayah, each a list of the recording's
 * ayahs: what makes a clip that starts on an ayah and ends on one exactly,
 * with no dragging. Before anything is selected it holds neither, and the
 * first ayah chosen is the whole clip until the last is.
 */
export const AyahRangePicker: React.FC<{
  ayahs: string[]; held: { from: string; to: string } | null; onAyahs: (from: string, to: string) => void;
}> = ({ ayahs, held, onAyahs }) => {
  const t = useT();
  const select = (value: string, label: string, onPick: (key: string) => void) => (
    <select value={value} onChange={e => onPick(e.target.value)} aria-label={label} dir="ltr"
      className="bg-slate-950 border border-slate-700 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/60">
      {!held && <option value="">—</option>}
      {ayahs.map(key => <option key={key} value={key}>{key}</option>)}
    </select>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-300">
      {t.clips.fromAyah}
      {select(held?.from ?? '', t.clips.fromAyahLabel, key => onAyahs(key, held?.to ?? key))}
      {t.clips.toAyah}
      {select(held?.to ?? '', t.clips.toAyahLabel, key => onAyahs(held?.from ?? key, key))}
    </span>
  );
};

/**
 * What can be done with the stretch selected on the timeline, on a row of its
 * own under the transport: its times, which can be typed, its length and the
 * ayahs in it, whether it snaps to whole ayahs, and making it a clip -- or
 * moving the open clip to it.
 */
export const ClipSelectionBar: React.FC<ClipSelectionBarProps> = ({
  start, end, origin, label, ayahs = [], held = null, onAyahs, snap, onSnap, onRange, makeText, onMake, keepLabel, onKeep, onReset
}) => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/[0.06]">
      <span className="flex items-center" dir="ltr">
        <TimeField value={start - origin} label={t.clips.selectionStart} onCommit={s => onRange(s + origin, end)} />
        <span className="text-slate-500">–</span>
        <TimeField value={end - origin} label={t.clips.selectionEnd} onCommit={s => onRange(start, s + origin)} />
      </span>
      <span className="font-mono text-[11px] text-slate-400" dir="ltr">{formatDuration(end - start)}</span>
      {ayahs.length > 0 && onAyahs
        ? <AyahRangePicker ayahs={ayahs} held={held} onAyahs={onAyahs} />
        : label && <span className="font-mono text-[11px] text-slate-100 px-1.5 py-0.5 rounded bg-amber-500/15" dir="ltr">{label}</span>}
      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none" title={t.clips.snapTitle}>
        <input type="checkbox" checked={snap} onChange={e => onSnap(e.target.checked)} className="w-3.5 h-3.5 accent-amber-500" />
        {t.clips.snap}
      </label>
      <span className="flex-1" />
      {onMake && makeText && (
        <button onClick={onMake} title={t.clips.makeClipTitle}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gold hover:bg-gold-bright text-ink text-xs font-bold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Plus className="w-3.5 h-3.5" />
          {makeText}
          <kbd className="hidden md:inline font-mono text-[10px] border border-ink/40 rounded px-1">↵</kbd>
        </button>
      )}
      {onKeep && keepLabel && (
        <button onClick={onKeep}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Scissors className="w-3.5 h-3.5 text-amber-400" />
          {keepLabel}
        </button>
      )}
      <button onClick={onReset} title={t.timeline.resetClip}
        className="px-2 py-1.5 text-xs font-semibold text-slate-300 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors">
        {t.common.reset}
      </button>
    </div>
  );
};
