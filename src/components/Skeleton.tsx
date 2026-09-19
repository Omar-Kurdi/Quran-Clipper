'use client';

import React from 'react';

/**
 * Placeholders shaped like what is about to arrive.
 *
 * A spinner says "something is happening"; a skeleton says what, and where it
 * will land -- so the eye is already on the timeline row, the list, the video
 * frame, when the content replaces it, and nothing jumps. Each composite here
 * mirrors the layout of the one thing it stands in for.
 *
 * Decorative throughout: every skeleton is `aria-hidden`, and the caller keeps
 * its own text status (the "Loading…" line, the match status) for assistive
 * technology. The pulse is `motion-safe`, so a reader who asked for reduced
 * motion gets a still placeholder.
 */

/** One grey bar. Size and shape come from `className`. */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={`block rounded bg-slate-700/45 motion-safe:animate-pulse ${className}`} style={style} />;
}

/**
 * Ayah blocks on the timeline track, before the passage has loaded or while
 * a match is running.
 *
 * Content-aware where it can be: given the blocks already on the timeline it
 * keeps their positions, so a re-match shimmers in place rather than blanking
 * the track. With nothing yet, it lays out `count` blocks of plausible,
 * varied widths -- ayahs are not all the same length, and a row of identical
 * bars reads as a progress meter.
 */
export function TimelineSkeleton({
  spans,
  count = 6
}: {
  /** Existing blocks as percentages of the track, to shimmer in place. */
  spans?: { left: number; width: number }[];
  count?: number;
}) {
  const blocks = spans?.length ? spans : placeholderSpans(count);
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none z-10">
      {blocks.map((span, index) => (
        <span
          key={index}
          className="absolute top-1 bottom-1 rounded-md border border-slate-600/60 bg-slate-800/70 overflow-hidden"
          style={{ left: `${span.left}%`, width: `${span.width}%` }}
        >
          <Skeleton className="mt-2 ms-2 h-2 w-8" />
          <Skeleton className="mt-2 ms-2 h-3 w-3/4" />
        </span>
      ))}
    </div>
  );
}

/** Widths that vary the way ayah lengths do, laid end to end across the track. */
const PLACEHOLDER_WEIGHTS = [1.4, 0.8, 1.1, 1.7, 0.9, 1.2, 1.5, 0.7];

export function placeholderSpans(count: number): { left: number; width: number }[] {
  const weights = Array.from({ length: Math.max(1, count) }, (_, i) => PLACEHOLDER_WEIGHTS[i % PLACEHOLDER_WEIGHTS.length]);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let left = 0;
  return weights.map(weight => {
    const width = (weight / total) * 100;
    const span = { left, width: Math.max(0.4, width - 0.3) };
    left += width;
    return span;
  });
}

/** Rows of a list: a title line and a shorter detail line each. */
export function ListSkeleton({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-3 ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 flex flex-col gap-2">
          <Skeleton className="h-3.5" style={{ width: `${70 - (index % 3) * 12}%` }} />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** The selected caption's panel: the ayah line, the Arabic, the translation and its words. */
export function InspectorSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 p-3">
      <Skeleton className="h-3 w-24" />
      <div className="rounded-lg border border-slate-800 p-3 flex flex-col gap-2">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5 ms-auto" />
      </div>
      <div className="rounded-lg border border-slate-800 p-3 flex flex-col gap-2">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[14, 10, 18, 12, 16, 9].map((width, index) => (
          <Skeleton key={index} className="h-6 rounded-full" style={{ width: `${width * 4}px` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * The video frame a render will fill, at its own aspect ratio, with how far
 * along it is. Stands in for the preview player while the preview renders.
 */
export function FrameSkeleton({ aspect, label }: { aspect: string; label: string }) {
  const [w, h] = aspect.split(':').map(Number);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 p-2">
      <div
        aria-hidden
        className="relative mx-auto max-h-64 rounded-md bg-slate-900 overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: w && h ? `${w} / ${h}` : '9 / 16', height: '16rem' }}
      >
        <div className="w-3/4 flex flex-col items-center gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="mt-2 h-2.5 w-2/3" />
        </div>
      </div>
      <p role="status" className="mt-1.5 text-[11px] text-slate-400 text-center">{label}</p>
    </div>
  );
}
