'use client';

import { useEffect, useRef } from 'react';

/**
 * SPACE plays/pauses, B ends the current ayah at the playhead, Ctrl+Z and
 * Ctrl+Shift+Z (or Ctrl+Y) walk the edit history, and ? opens the list of all
 * of them.
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
export function useTransportKeys(handlers: {
  onTogglePlay: () => void;
  onMarkHere: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onShowShortcuts?: () => void;
}) {
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
        return;
      }

      // Undo and redo. The `typing` guard above already handed the text boxes
      // their own native undo, which is what someone editing a translation
      // means by Ctrl+Z -- this one is for the timeline behind it.
      //
      // Matched by physical key *or* by name: `code` is what survives an Arabic
      // layout, and `key` is what still arrives from the stacks that send no
      // code at all -- remote desktops, some IMEs, most automation.
      const chord = (physical: string, letter: string) =>
        e.code === physical || (!e.code && e.key.toLowerCase() === letter);

      if ((e.ctrlKey || e.metaKey) && !e.altKey && chord('KeyZ', 'z')) {
        e.preventDefault();
        if (e.shiftKey) latest.current.onRedo?.();
        else latest.current.onUndo?.();
        return;
      }
      // Ctrl+Y is redo on Windows, and costs nothing to accept everywhere.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && chord('KeyY', 'y')) {
        e.preventDefault();
        latest.current.onRedo?.();
        return;
      }

      // `?` by name as well as by physical key: unlike Space and B, which key
      // carries a question mark depends entirely on the layout, and an Arabic
      // one is likely here.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '?' || (e.shiftKey && e.code === 'Slash'))) {
        e.preventDefault();
        latest.current.onShowShortcuts?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
