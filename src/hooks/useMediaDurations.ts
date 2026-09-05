'use client';

import { useEffect, useState } from 'react';
import { knownMediaDuration, loadMediaDuration } from '@/lib/mediaDuration';

/**
 * The measured length of each clip, as it arrives.
 *
 * State rather than a cache read, deliberately: the measurement resolves after
 * the render that asked for it, so a component that only read the cache would
 * paint once, learn nothing, and never paint again.
 *
 * The work is keyed by the *contents* of `urls` rather than by its identity:
 * callers build the list inline from props, so a fresh array of the same urls
 * every render is the normal case and must not restart anything.
 */
export function useMediaDurations(urls: string[], enabled = true): Record<string, number> {
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const key = urls.filter(Boolean).join('\n');

  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    // Read back out of the key rather than closing over the array: it is the
    // same list, and it is what this effect actually depends on.
    const wanted = Array.from(new Set(key.split('\n')));

    for (const url of wanted) {
      // Already measured and unmeasurable: nothing will change by asking again.
      if (knownMediaDuration(url) === null) continue;
      // Always through the promise, cached or not. A cached answer resolves on
      // the next microtask, which keeps this out of the effect body -- React
      // treats a synchronous setState there as a cascading render.
      loadMediaDuration(url).then(value => {
        if (cancelled || value === null) return;
        setLengths(prev => (prev[url] === value ? prev : { ...prev, [url]: value }));
      });
    }

    return () => { cancelled = true; };
  }, [key, enabled]);

  return lengths;
}
