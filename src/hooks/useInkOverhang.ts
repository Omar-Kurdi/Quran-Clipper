'use client';

import { useEffect, useState, type RefObject } from 'react';

/** How far a word's drawing reaches past the space its font reserves for it, on each side, in px. */
export interface Overhang {
  start: number;
  end: number;
}

/**
 * The overhang of each `[data-word]` element under `root`, re-measured as
 * fonts arrive.
 *
 * The mushaf's page fonts draw a word as one glyph whose ink can run well past
 * its advance width -- on the printed line the next word sits over the tail.
 * ٱلرَّحِيمِ on page 1 reserves 31px at 24px and draws 69px. Laid out on its own
 * in a box, that tail spills over the border and into the next box, so the box
 * is padded by what the ink actually needs. Read from the canvas, since layout
 * only ever reports the advance.
 */
export function useInkOverhang(root: RefObject<HTMLElement | null>, key: string): Overhang[] {
  const [overhang, setOverhang] = useState<Overhang[]>([]);
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      const words = root.current ? [...root.current.querySelectorAll<HTMLElement>('[data-word]')] : [];
      if (!ctx || cancelled) return;
      setOverhang(words.map(word => {
        const style = getComputedStyle(word);
        ctx.font = `${style.fontSize} ${style.fontFamily}`;
        ctx.direction = 'rtl';
        // Right-to-left, from the start (right) edge: ink to the left beyond the
        // advance is on the end side, ink to the right of it on the start side.
        const m = ctx.measureText(word.textContent ?? '');
        return {
          start: Math.max(0, Math.ceil(m.actualBoundingBoxRight)),
          end: Math.max(0, Math.ceil(m.actualBoundingBoxLeft - m.width))
        };
      }));
    };
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [root, key]);
  return overhang;
}
