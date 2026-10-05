'use client';

import { useEffect, useState } from 'react';
import { knownLoopWindow, loadLoopWindow, type LoopWindow } from '@/lib/clipLoop';
import { mediaKind } from '@/lib/backgroundTimeline';

/**
 * The part of each clip that loops, as it is measured -- see `clipLoop`.
 *
 * The same shape as `useMediaDurations`, for the same reasons: state rather
 * than a cache read, and keyed by the contents of `urls`.
 */
export function useLoopWindows(urls: string[], enabled = true): Record<string, LoopWindow> {
  const [loops, setLoops] = useState<Record<string, LoopWindow>>({});
  // A still has no loop to measure.
  const key = urls.filter(url => url && mediaKind(url) === 'video').join('\n');

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    for (const url of Array.from(new Set(key.split('\n')))) {
      if (knownLoopWindow(url) === null) continue;
      loadLoopWindow(url).then(loop => {
        if (cancelled || !loop) return;
        setLoops(prev => (prev[url]?.start === loop.start && prev[url]?.end === loop.end ? prev : { ...prev, [url]: loop }));
      });
    }
    return () => { cancelled = true; };
  }, [key, enabled]);

  return loops;
}
