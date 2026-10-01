'use client';

import { useEffect, useState, type RefObject } from 'react';

export interface OffsetBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where an element sits inside its offset parent, kept current as either is
 * resized. For laying a DOM layer exactly over something whose size comes from
 * CSS rather than from us -- the preview canvas, letterboxed into its pane.
 */
export function useOffsetBox(ref: RefObject<HTMLElement | null>, enabled: boolean): OffsetBox | null {
  const [box, setBox] = useState<OffsetBox | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () =>
      setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return enabled ? box : null;
}
