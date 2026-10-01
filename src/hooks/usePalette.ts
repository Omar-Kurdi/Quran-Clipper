'use client';

import { useSyncExternalStore } from 'react';

/**
 * The studio's live colour scheme, for the few things drawn on a canvas.
 *
 * Everything else follows a palette switch through CSS variables without
 * re-rendering. A canvas does not: it keeps the colour it was painted in, so
 * the timeline's waveform stayed a dark scheme's grey on Parchment's paper.
 * Reading this in a draw effect's dependencies repaints it on a switch.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] });
  return () => observer.disconnect();
}

const current = () => document.documentElement.dataset.palette ?? '';
const onServer = () => '';

export function usePalette(): string {
  return useSyncExternalStore(subscribe, current, onServer);
}

/** A palette variable's value right now, such as `--p-muted`. */
export function paletteColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
