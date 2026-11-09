'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addClip, clipStyle, moveClip, newClip, removeClip, settleLooks, switchOwnLook, type RecordingClip
} from '@/lib/recordingClips';

/**
 * The clips and which one is open, kept in a ref as well as in state, so what
 * was just changed can be acted on before the studio renders again.
 */
function useClipList<C extends object>(config: C) {
  const [state, setState] = useState<{ clips: RecordingClip[]; activeId: string | null }>({ clips: [], activeId: null });
  const latest = useRef({ config, ...state });
  /** The shared look, while a clip with its own look is open; the config is it otherwise. */
  const shared = useRef<C | null>(null);
  useEffect(() => {
    latest.current = { config, ...state };
  });
  /** The clips and the open one, and the config it is now drawn with when that changes too. */
  const commit = useCallback((clips: RecordingClip[], activeId: string | null, drawn?: C) => {
    latest.current = { config: drawn ?? latest.current.config, clips, activeId };
    setState({ clips, activeId });
  }, []);

  /** A new clip for this stretch, with the shared look; returns its id, or null when there is no clip there. */
  const add = useCallback((start: number, end: number, duration: number): string | null => {
    const current = latest.current.clips;
    const next = addClip(current, newClip(start, end, duration));
    if (next === current) return null;
    commit(next, latest.current.activeId);
    return next[next.length - 1].id;
  }, [commit]);

  const move = useCallback((id: string, start: number, end: number, duration: number) => {
    commit(moveClip(latest.current.clips, id, start, end, duration), latest.current.activeId);
  }, [commit]);

  /** Starts over with these clips -- none for a new recording -- and the whole recording open. */
  const reset = useCallback((next: RecordingClip[] = []) => {
    shared.current = null;
    commit(next, null);
  }, [commit]);

  return { state, latest, sharedRef: shared, commit, add, move, reset };
}

/**
 * The clips cut from the recording on screen, which one is open, and the look
 * they share (`recordingClips.ts`).
 *
 * The studio's config is always the look of what is open. So nothing else in
 * the studio has to know about clips: the shared look is taken from it when a
 * clip that has the shared look -- or the whole recording -- is left, and a
 * clip with its own look keeps what it changes from the shared one. Opening a
 * clip puts its look in the config.
 */
export function useRecordingClips<C extends object>(config: C, setConfig: (config: C) => void) {
  const { state, latest, sharedRef, commit, add, move, reset } = useClipList(config);
  /** The looks as last kept, which an open that keeps nothing goes back to. */
  const keptRef = useRef<{ base: C; clips: RecordingClip[] } | null>(null);

  /** The shared look and every clip's own, as they stand now, the open clip's included. */
  const settled = useCallback(
    () => settleLooks(latest.current.config, latest.current.clips, latest.current.activeId, sharedRef.current),
    [latest, sharedRef]
  );

  /**
   * Opens a clip, or the whole recording for null.
   *
   * `keep: false` leaves the looks as they were when last kept: a render queue
   * moving between clips changes the frame's shape for each render, and that
   * is not a change anyone made to a clip's look -- so it opens on the looks
   * as last kept, never on the config the queue has been reshaping.
   */
  const open = useCallback((id: string | null, { keep = true }: { keep?: boolean } = {}) => {
    const now = keep || !keptRef.current ? settled() : keptRef.current;
    if (keep) keptRef.current = now;
    const next = now.clips.find(clip => clip.id === id) ?? null;
    sharedRef.current = next?.style ? now.base : null;
    const drawn = clipStyle(now.base, next);
    commit(now.clips, next?.id ?? null, drawn);
    setConfig(drawn);
  }, [settled, sharedRef, commit, setConfig]);

  /** Gives the open clip a look of its own, starting from the shared one, or gives it back the shared one. */
  const ownLook = useCallback((on: boolean) => {
    const now = latest.current;
    const changed = switchOwnLook(on, now.config, now.clips, now.activeId, sharedRef.current);
    if (!changed) return;
    sharedRef.current = changed.shared;
    commit(changed.clips, now.activeId);
    if (changed.config !== now.config) setConfig(changed.config);
  }, [latest, sharedRef, commit, setConfig]);

  const remove = useCallback((id: string) => {
    if (latest.current.activeId === id) open(null);
    commit(removeClip(latest.current.clips, id), latest.current.activeId);
  }, [latest, open, commit]);

  const active = state.clips.find(clip => clip.id === state.activeId) ?? null;
  return {
    clips: state.clips, activeId: state.activeId, active,
    open, ownLook, add, remove, move, reset, settled
  };
}
