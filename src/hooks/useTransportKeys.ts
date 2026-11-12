'use client';

import { useEffect, useRef } from 'react';

/** `KeyB` or `KeyN` pressed on its own -- by physical key, or by name where no code is sent. */
function bareLetter(e: KeyboardEvent): 'KeyB' | 'KeyN' | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const code = e.code || `Key${e.key.toUpperCase()}`;
  return code === 'KeyB' || code === 'KeyN' ? code : null;
}

/**
 * The keys added after the first set, as a plain function so they can be
 * tested: Ctrl+S saves, and [ and ] step to the caption before and after the
 * selected one. By physical key, or by name where no code is sent, for the
 * same reasons as the rest (see below).
 */
export function extraShortcut(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>):
  'save' | 'prev-caption' | 'next-caption' | null {
  const is = (physical: string, name: string) => e.code === physical || (!e.code && e.key.toLowerCase() === name);
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) return !e.shiftKey && is('KeyS', 's') ? 'save' : null;
  if (is('BracketLeft', '[')) return 'prev-caption';
  if (is('BracketRight', ']')) return 'next-caption';
  return null;
}

type ExtraHandlers = { onSave?: () => void; onStepCaption?: (direction: -1 | 1) => void };

/**
 * Listens for the keys `extraShortcut` names. A listener of its own beside the
 * transport's: none of these keys is one of its, so neither sees the other's.
 */
function useExtraShortcuts(latest: React.RefObject<ExtraHandlers>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const extra = extraShortcut(e);
      if (!extra) return;
      // Saving works from a text box too: Ctrl+S there would otherwise offer
      // to save the web page, which is never what was meant.
      if (extra === 'save') {
        e.preventDefault();
        if (!e.repeat) latest.current?.onSave?.();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return;
      e.preventDefault();
      latest.current?.onStepCaption?.(extra === 'prev-caption' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [latest]);
}

/**
 * SPACE plays/pauses, B ends the current ayah at the playhead, N goes to the
 * next caption marked for checking, [ and ] to the caption before and after
 * the selected one, Ctrl+Z and
 * Ctrl+Shift+Z (or Ctrl+Y) walk the edit history, Ctrl+S saves the clip to
 * Projects, and ? opens the list of all of them.
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
  onNextToCheck?: () => void;
  onSave?: () => void;
  /** -1 for the caption before the selected one, 1 for the one after. */
  onStepCaption?: (direction: -1 | 1) => void;
}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  }, [handlers]);
  useExtraShortcuts(latest);

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

      // B and N with no modifier, so Ctrl/Cmd+B cannot silently drop a
      // boundary and Ctrl/Cmd+N still opens a window.
      const letter = bareLetter(e);
      if (letter === 'KeyB') {
        e.preventDefault();
        latest.current.onMarkHere();
        return;
      }
      if (letter === 'KeyN') {
        e.preventDefault();
        latest.current.onNextToCheck?.();
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
