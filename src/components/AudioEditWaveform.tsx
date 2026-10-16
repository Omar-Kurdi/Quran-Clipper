'use client';

import React, { useEffect, useRef } from 'react';
import { useT } from './LocaleProvider';
import { MIN_CUT_SEC, normalizeEdit, type AudioEdit, type Span } from '@/lib/audioEdit';
import type { VerseData } from '@/lib/quranData';

/** A stretch of the recording picked on the waveform; `cut` when it is one of the edit's cuts. */
export type Selection = (Span & { cut?: number }) | null;

export const WAVE_BUCKETS = 1600;

interface WaveformProps {
  peaks: Float32Array;
  duration: number;
  draft: AudioEdit;
  selection: Selection;
  playhead: number;
  onDraft: (edit: AudioEdit) => void;
  onSelection: (selection: Selection) => void;
  onSeek: (time: number) => void;
  /** Taller, in the expanded dialog. */
  tall?: boolean;
}

/** The recording as a waveform, what is cut drawn over it, and the selection to cut next. */
export const AudioEditWaveform: React.FC<WaveformProps> = props => {
  const { peaks, duration, draft, selection, playhead } = props;
  const t = useT();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useWaveCanvas(peaks);
  const pointer = useWaveDrag(trackRef, props);
  const pct = (time: number) => (duration ? (time / duration) * 100 : 0);
  return (
    <div
      ref={trackRef}
      className={`relative ${props.tall ? 'h-48' : 'h-36'} rounded-lg bg-slate-950 border border-slate-800 cursor-crosshair touch-none select-none overflow-hidden`}
      onPointerDown={pointer.down}
      onPointerMove={pointer.move}
      onPointerUp={pointer.up}
      aria-label={t.editAudio.waveform}
      role="group"
    >
      <canvas ref={canvasRef} width={WAVE_BUCKETS} height={160} className="absolute inset-0 w-full h-full" />
      {draft.cuts.map((cut, i) => (
        <span
          key={`${cut.start}-${cut.end}`}
          title={cut.auto ? t.editAudio.autoCut : t.editAudio.handCut}
          className={`absolute inset-y-0 pointer-events-none border-x ${cut.auto ? AUTO_CUT : HAND_CUT} ${selection?.cut === i ? 'ring-2 ring-blue-400' : ''}`}
          style={{ left: `${pct(cut.start)}%`, width: `${Math.max(0.15, pct(cut.end) - pct(cut.start))}%` }}
        />
      ))}
      {selection && <SelectionMarks selection={selection} pct={pct} onEdgeDown={pointer.edgeDown} />}
      <span className="absolute inset-y-0 -ml-px w-0.5 bg-lapis-bright pointer-events-none" style={{ left: `${pct(playhead)}%` }} />
    </div>
  );
};

const AUTO_CUT = 'bg-amber-500/35 border-amber-400/70';
const HAND_CUT = 'bg-red-500/40 border-red-400/80';

/** The selection's shading, unless it is a cut already drawn, and a handle at each edge. */
const SelectionMarks: React.FC<{
  selection: Span & { cut?: number };
  pct: (time: number) => number;
  onEdgeDown: (e: React.PointerEvent<HTMLElement>, edge: 'start' | 'end') => void;
}> = ({ selection, pct, onEdgeDown }) => {
  const t = useT();
  return (
    <>
      {selection.cut === undefined && (
        <span
          className="absolute inset-y-0 bg-blue-400/25 border-x-2 border-blue-400 pointer-events-none"
          style={{ left: `${pct(selection.start)}%`, width: `${pct(selection.end) - pct(selection.start)}%` }}
        />
      )}
      {(['start', 'end'] as const).map(edge => (
        <span
          key={edge}
          role="separator"
          aria-label={edge === 'start' ? t.editAudio.moveStart : t.editAudio.moveEnd}
          onPointerDown={e => onEdgeDown(e, edge)}
          className="absolute inset-y-0 -ml-2 w-4 cursor-ew-resize hover:bg-blue-400/40"
          style={{ left: `${pct(selection[edge])}%` }}
        />
      ))}
    </>
  );
};

/** Draws the peaks once they are read. */
function useWaveCanvas(peaks: Float32Array) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#b8873a';
    const step = width / peaks.length;
    peaks.forEach((peak, i) => {
      const h = Math.max(1, peak * height * 0.95);
      ctx.fillRect(i * step, (height - h) / 2, Math.max(1, step - 0.5), h);
    });
  }, [peaks]);
  return canvasRef;
}

/**
 * Dragging on the waveform selects; dragging a handle moves that edge, and
 * the cut with it when the selection is one; a click selects a cut or moves
 * the playhead there.
 */
function useWaveDrag(trackRef: React.RefObject<HTMLDivElement | null>, props: WaveformProps) {
  const { duration, draft, selection, onDraft, onSelection, onSeek } = props;
  // A ref, not state: nothing is drawn from it, and a quick tap's up arrives
  // before a re-render would hand the handlers the down's state.
  const dragRef = useRef<{ from: number; edge?: 'start' | 'end' } | null>(null);
  const toTime = (clientX: number) => timeAt(trackRef.current, clientX, duration);

  const down = (e: React.PointerEvent<HTMLElement>) => {
    dragRef.current = { from: toTime(e.clientX) };
    onSelection(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const edgeDown = (e: React.PointerEvent<HTMLElement>, edge: 'start' | 'end') => {
    e.stopPropagation();
    if (!selection) return;
    dragRef.current = { from: edge === 'start' ? selection.end : selection.start, edge };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const at = toTime(e.clientX);
    const span = { start: Math.min(drag.from, at), end: Math.max(drag.from, at) };
    if (span.end - span.start < MIN_CUT_SEC) return;
    const cut = drag.edge ? selection?.cut : undefined;
    // Moving a cut's edge moves the cut, which stays the one selected.
    if (cut !== undefined) onDraft(normalizeEdit({ ...draft, cuts: draft.cuts.map((c, i) => (i === cut ? span : c)) }, duration));
    onSelection({ ...span, cut });
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const at = toTime(e.clientX);
    if (drag && !drag.edge && Math.abs(at - drag.from) < MIN_CUT_SEC) clickAt(at);
  };
  /** A click: a cut is selected, anywhere else is where to listen from. */
  const clickAt = (at: number) => {
    const index = draft.cuts.findIndex(cut => at >= cut.start && at <= cut.end);
    if (index >= 0) onSelection({ ...draft.cuts[index], cut: index });
    else onSeek(at);
  };
  return { down, edgeDown, move, up };
}

/** The moment of the recording under `clientX` on the track. */
function timeAt(track: HTMLElement | null, clientX: number, duration: number): number {
  const rect = track?.getBoundingClientRect();
  if (!rect || !duration) return 0;
  return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
}

/** The captions under the waveform: clicking one selects its stretch, to cut it with its audio. */
export const CaptionLane: React.FC<{ captions: VerseData[]; duration: number; onSelect: (span: Span) => void }> = ({
  captions, duration, onSelect,
}) => {
  const t = useT();
  const pct = (time: number) => (duration ? (time / duration) * 100 : 0);
  return (
    <div className="relative h-6 -mt-3" aria-label={t.editAudio.captionsLane}>
      {captions.map((caption, i) => (
        <button
          key={`${caption.verseKey}-${i}`}
          onClick={() => onSelect({ start: caption.startTime, end: caption.endTime })}
          title={t.editAudio.selectCaption(caption.verseKey)}
          className="absolute top-0 h-6 truncate px-1 text-[10px] font-mono text-slate-300 bg-slate-800/80 hover:bg-slate-700 border-x border-slate-600 rounded-sm"
          style={{ left: `${pct(caption.startTime)}%`, width: `${Math.max(0.5, pct(caption.endTime) - pct(caption.startTime))}%` }}
        >
          {caption.verseKey}
        </button>
      ))}
    </div>
  );
};
