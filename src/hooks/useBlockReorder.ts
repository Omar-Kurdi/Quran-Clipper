'use client';

import { useEffect, useRef, useState } from 'react';

/** How far the pointer must travel before a press on a block becomes a drag. */
const DRAG_THRESHOLD_PX = 6;

interface Span {
  startTime: number;
  endTime: number;
}

/**
 * Where a block dropped at `time` lands, as an index into the list with the
 * dragged block taken out -- the index `reorder` in `verseEdits` expects.
 *
 * Each remaining block votes by its midpoint: past the middle of a block is
 * after it. So a drop anywhere over the first half of the third block puts
 * the dragged one before it.
 */
export function dropIndex(spans: Span[], from: number, time: number): number {
  let index = 0;
  spans.forEach((span, i) => {
    if (i !== from && (span.startTime + span.endTime) / 2 < time) index += 1;
  });
  return index;
}

/**
 * Where the insertion line is drawn for a drop at `to`, in seconds: the start
 * of the block it will sit before, or the end of the last one.
 */
export function dropMarker(spans: Span[], from: number, to: number): number {
  const rest = spans.filter((_, i) => i !== from);
  if (!rest.length) return 0;
  return to < rest.length ? rest[to].startTime : rest[rest.length - 1].endTime;
}

/**
 * Pointer moves and the release, from the whole window while `active` -- so a
 * drag carries on when the pointer leaves the element it started on. The
 * handlers are read fresh on each event rather than re-subscribed.
 */
function useWindowPointer(active: boolean, onMove: (event: PointerEvent) => void, onUp: () => void) {
  const handlers = useRef({ onMove, onUp });
  useEffect(() => {
    handlers.current = { onMove, onUp };
  });
  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => handlers.current.onMove(event);
    const up = () => handlers.current.onUp();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active]);
}

/**
 * Dragging an ayah block by its body to move it elsewhere in the order.
 *
 * The body, not the edges: the edges are the boundary drag and stay exactly as
 * they were. A press that does not travel is still a click -- select and seek
 * -- and only a press that moves past a few pixels becomes a reorder, which
 * then swallows the click the browser fires on release.
 */
export function useBlockReorder(params: {
  spans: Span[];
  xToTime: (clientX: number) => number;
  onReorder?: (from: number, to: number) => void;
}) {
  type Press = { from: number; startX: number; active: boolean; to: number };
  const [press, setPress] = useState<Press | null>(null);
  // The same press, readable from the window listeners without re-subscribing
  // on every move -- and without doing the reorder inside a state updater,
  // which React may run twice.
  const pressRef = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  // The handlers are this render's, so `params` in them is always current.
  useWindowPointer(press !== null, event => {
    const current = pressRef.current;
    if (!current) return;
    const { spans, xToTime } = params;
    const active = current.active || Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD_PX;
    const to = active ? dropIndex(spans, current.from, xToTime(event.clientX)) : current.to;
    if (active === current.active && to === current.to) return;
    pressRef.current = { ...current, active, to };
    setPress(pressRef.current);
  }, () => {
    const current = pressRef.current;
    pressRef.current = null;
    setPress(null);
    if (!current?.active) return;
    suppressClick.current = true;
    if (current.to !== current.from) params.onReorder?.(current.from, current.to);
  });

  return {
    /** The drag in progress, once it has moved far enough to be one. */
    dragging: press?.active ? { from: press.from, to: press.to } : null,
    begin: (index: number, clientX: number) => {
      if (!params.onReorder) return;
      suppressClick.current = false;
      pressRef.current = { from: index, startX: clientX, active: false, to: index };
      setPress(pressRef.current);
    },
    /** True once, for the click that ends a drag, which must not also select and seek. */
    consumeClick: () => {
      const was = suppressClick.current;
      suppressClick.current = false;
      return was;
    }
  };
}
