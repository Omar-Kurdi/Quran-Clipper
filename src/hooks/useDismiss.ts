'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on a press outside it or on Escape.
 *
 * The header's menus each carried their own copy of these two listeners.
 */
export function useDismiss(open: boolean, close: () => void, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close, rootRef]);
}
