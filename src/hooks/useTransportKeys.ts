'use client';

import { useEffect, useRef } from 'react';

/**
 * SPACE plays/pauses, B ends the current ayah at the playhead.
 *
 * Space used to do both -- play when paused, mark when playing -- which meant
 * there was no way to pause without cutting a boundary you didn't want.
 *
 * The two keys guard differently, on purpose. Space skips a focused BUTTON so
 * it still activates that button rather than being hijacked; B must not, or the
 * key stops working the moment someone clicks Play, which is exactly when they
 * need it. Both skip text entry, and B ignores modifier chords so Ctrl/Cmd+B
 * cannot silently drop a boundary.
 *
 * `e.code` rather than `e.key`: it names the physical key regardless of the
 * active layout, which matters because someone captioning Arabic recitation may
 * well have an Arabic layout selected while they work.
 *
 * The handlers are held in refs and the listener is bound once, so a re-render
 * cannot leave a stale closure bound to the window.
 */
export function useTransportKeys(handlers: { onTogglePlay: () => void; onMarkHere: () => void }) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
      if (typing) return;

      if (e.code === 'Space') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        latest.current.onTogglePlay();
        return;
      }

      if (e.code === 'KeyB') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        latest.current.onMarkHere();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
