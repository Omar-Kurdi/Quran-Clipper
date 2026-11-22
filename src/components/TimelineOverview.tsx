'use client';

import React, { useRef } from 'react';
import { useT } from './LocaleProvider';

/** A pause this long is a break between ayahs, more often than not; the shorter breaths are left off the strip. */
const LONG_PAUSE_SEC = 0.6;

interface TimelineOverviewProps {
  /** The stretch of time the whole track covers. */
  start: number;
  span: number;
  currentTime: number;
  /** The recording's pauses (`pauses.ts`), drawn as ticks: where its stretches can start and end. */
  pauses?: { start: number; end: number }[];
  /** What part of the track is scrolled into view, as fractions of its width. */
  visible: { left: number; width: number };
  /** Scroll so this fraction of the track is in the middle of the view. */
  onJump: (fraction: number) => void;
}

/**
 * The whole of a zoomed-in timeline in one thin strip: the playhead, and a box for the part on screen. Press or drag anywhere on it to
 * bring that part into view -- the way to reach 1:08:00 in a two-hour recording
 * without scrolling through the hour before it.
 */
export const TimelineOverview: React.FC<TimelineOverviewProps> = ({ start, span, currentTime, visible, onJump, pauses = [] }) => {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  };
  const pct = (time: number) => `${Math.max(0, Math.min(100, ((time - start) / span) * 100))}%`;
  return (
    <div
      ref={ref}
      dir="ltr"
      role="slider"
      tabIndex={-1}
      aria-label={t.timeline.overview}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((visible.left + visible.width / 2) * 100)}
      title={t.timeline.overviewTitle}
      className="relative h-4 mx-0 border-b border-slate-800/70 bg-slate-950/70 cursor-pointer touch-none select-none"
      onPointerDown={e => {
        dragging.current = true;
        onJump(at(e.clientX));
        // Keeps a drag going once the pointer leaves the strip; a press is always an active pointer.
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => { if (dragging.current) onJump(at(e.clientX)); }}
      onPointerUp={e => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      {pauses.filter(pause => pause.end - pause.start >= LONG_PAUSE_SEC).map(pause => (
        <span key={pause.start} aria-hidden="true" className="absolute bottom-0 h-1.5 w-px bg-slate-400/60" style={{ left: pct((pause.start + pause.end) / 2) }} />
      ))}
      <span className="absolute inset-y-0 w-0.5 bg-lapis-bright" style={{ left: pct(currentTime) }} />
      <span
        className="absolute inset-y-0 rounded-sm border border-slate-200/80 bg-slate-100/10 pointer-events-none"
        style={{ left: `${visible.left * 100}%`, width: `${Math.max(0.5, visible.width * 100)}%` }}
      />
    </div>
  );
};
