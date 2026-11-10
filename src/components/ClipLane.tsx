'use client';

import React, { useEffect, useRef, useState } from 'react';
import { dragClip, type ClipEdge } from '@/lib/recordingClips';
import { useT } from './LocaleProvider';

/** One colour per clip, in turn, so overlapping clips can be told apart. */
const CLIP_COLOURS = [
  'border-amber-400/70 bg-amber-400/15 text-amber-100',
  'border-emerald-400/70 bg-emerald-400/15 text-emerald-100',
  'border-violet-400/70 bg-violet-400/15 text-violet-100',
  'border-sky-400/70 bg-sky-400/15 text-sky-100'
];

/** How far the pointer moves before a press on a bar is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface ClipLaneProps {
  /** In the order they play, which is the order they are numbered in. */
  clips: { id: string; start: number; end: number; label: string }[];
  activeId: string | null;
  /** The recording's length, which a bar is kept inside. */
  duration: number;
  /** Where a time sits across the track, in percent, and the time under a pointer. */
  pct: (time: number) => number;
  xToTime: (clientX: number) => number;
  clock: (time: number) => string;
  onOpen?: (id: string | null) => void;
  /** A clip given a new stretch by dragging its bar. */
  onMove?: (id: string, start: number, end: number) => void;
}

interface Drag {
  id: string;
  edge: ClipEdge;
  /** The time and x under the pointer when it went down, and the clip as it was. */
  fromTime: number;
  fromX: number;
  base: { start: number; end: number };
}

/**
 * The bar being dragged, if any: shown from here while the pointer moves and
 * committed once, on release, as the background blocks are -- a drag is one
 * edit. A press that never moves past `DRAG_THRESHOLD_PX` is a click.
 */
function useClipDrag(duration: number, xToTime: (x: number) => number, onMove: ClipLaneProps['onMove']) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  /** Set when a press became a drag, so the click that follows it does not also open the clip. */
  const dragged = useRef(false);
  const latest = useRef({ duration, xToTime, onMove });
  useEffect(() => {
    latest.current = { duration, xToTime, onMove };
  });

  useEffect(() => {
    if (!drag) return;
    let pending: { start: number; end: number } | null = null;
    const move = (e: PointerEvent) => {
      if (!pending && Math.abs(e.clientX - drag.fromX) < DRAG_THRESHOLD_PX) return;
      const { duration: last, xToTime: toTime } = latest.current;
      pending = dragClip(drag.base, drag.edge, toTime(e.clientX) - drag.fromTime, last);
      dragged.current = true;
      setPreview({ id: drag.id, ...pending });
    };
    const up = () => {
      if (pending) latest.current.onMove?.(drag.id, pending.start, pending.end);
      setPreview(null);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]);

  const begin = (e: React.PointerEvent, clip: { id: string; start: number; end: number }, edge: ClipEdge) => {
    if (!latest.current.onMove || e.button !== 0) return;
    e.stopPropagation();
    dragged.current = false;
    setDrag({ id: clip.id, edge, fromTime: xToTime(e.clientX), fromX: e.clientX, base: { start: clip.start, end: clip.end } });
  };
  /** Whether the click now arriving ends a drag, and so is no click; reads it once. */
  const endedDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { preview, begin, endedDrag };
}

interface BarProps {
  clip: ClipLaneProps['clips'][number];
  name: string;
  colour: string;
  /** Drawn in the second row, under a clip it overlaps. */
  lower: boolean;
  active: boolean;
  dragging: boolean;
  /** A title saying what it is and what can be done with it. */
  title: string;
  onPress: (e: React.PointerEvent, edge: ClipEdge) => void;
  onClick: () => void;
  draggable: boolean;
  /** Where it sits on the lane. */
  style: React.CSSProperties;
}

/** One clip's bar: the clip to press, with an end to drag at either side. */
const ClipBar: React.FC<BarProps> = ({ clip, name, colour, lower, active, dragging, title, onPress, onClick, draggable, style }) => (
  <button
    style={style}
    onPointerDown={e => onPress(e, 'move')}
    onClick={onClick}
    title={title}
    aria-pressed={active}
    className={`absolute ${lower ? 'top-[15px]' : 'top-0.5'} h-[15px] rounded-sm border px-1.5 text-[9px] leading-none text-start truncate transition-colors touch-none ${
      draggable ? 'cursor-grab active:cursor-grabbing' : ''
    } ${colour} ${active ? 'ring-2 ring-gold z-10' : 'hover:brightness-125'} ${dragging ? 'z-20 brightness-125' : ''}`}
  >
    {draggable && (['start', 'end'] as const).map(edge => (
      <span
        key={edge}
        onPointerDown={e => onPress(e, edge)}
        aria-hidden="true"
        className={`absolute inset-y-0 ${edge === 'start' ? 'left-0' : 'right-0'} w-1.5 cursor-ew-resize hover:bg-gold/50`}
      />
    ))}
    {name}{clip.label ? ` · ${clip.label}` : ''}
  </button>
);

/**
 * The recording's clips (`recordingClips.ts`), a bar each on a lane above the
 * ruler. A click opens a clip, or goes back to the whole recording from the
 * open one; dragging a bar moves the clip, and dragging either end of it
 * changes where it starts or ends. Overlapping clips stack in two rows.
 */
export const ClipLane: React.FC<ClipLaneProps> = ({ clips, activeId, duration, pct, xToTime, clock, onOpen, onMove }) => {
  const t = useT();
  const { preview, begin, endedDrag } = useClipDrag(duration, xToTime, onMove);
  if (!clips.length) return null;
  const shown = clips.map(clip => (preview?.id === clip.id ? { ...clip, start: preview.start, end: preview.end } : clip));
  return (
    <div className="relative h-8 border-b border-slate-800/70 bg-slate-950/40" aria-label={t.clips.lane}>
      {shown.map((each, i) => {
        const left = pct(each.start);
        const name = t.clips.name(i + 1);
        const active = each.id === activeId;
        const span = `${clock(each.start)} – ${clock(each.end)}`;
        return (
          <ClipBar
            key={each.id}
            clip={each}
            name={name}
            colour={CLIP_COLOURS[i % CLIP_COLOURS.length]}
            lower={shown.slice(0, i).some(other => other.end > each.start && other.start < each.end)}
            active={active}
            dragging={preview?.id === each.id}
            draggable={!!onMove}
            title={onMove ? t.clips.barTitle(name, clock(each.start), clock(each.end)) : `${name} · ${span}`}
            onPress={(e, edge) => begin(e, each, edge)}
            onClick={() => { if (!endedDrag()) onOpen?.(active ? null : each.id); }}
            style={{ left: `${left}%`, width: `${Math.max(0.4, pct(each.end) - left)}%` }}
          />
        );
      })}
    </div>
  );
};
