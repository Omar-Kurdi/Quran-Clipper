'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  History, initHistory, record, replacePresent,
  undo as undoHistory, redo as redoHistory, canUndo, canRedo
} from '@/lib/editHistory';
import { VerseData } from '@/lib/quranData';

/**
 * What an undo puts back.
 *
 * Exactly the timeline, the selection and the styling config -- the project, in
 * other words. Not the transport, the playhead, the audio, the export or the
 * background library: none of those are edits of the thing being made, and
 * putting the playhead back where it was two minutes ago in the middle of
 * checking a caption would be its own bug.
 */
export interface StudioSnapshot<C> {
  verses: VerseData[];
  /** A passenger: restored with a step, but never the reason one is recorded. */
  selectedIndex: number;
  config: C;
}

export interface EditHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Ctrl+Z over the studio.
 *
 * The state is watched rather than written through: every edit already goes
 * through `setVerses`/`setCanvasConfig` from a dozen call sites, and asking
 * each of them to also record a step is exactly the kind of bookkeeping that is
 * correct for a month and then quietly is not.
 *
 * Restoring is what makes that safe. `restore` hands the *same references* back
 * to React, so the watching effect below sees state identical to the present it
 * already holds and records nothing -- no flag, no ref, no race between the
 * restore and the effect that follows it.
 */
export function useEditHistory<C>({
  verses,
  selectedIndex,
  config,
  restore
}: StudioSnapshot<C> & { restore: (snapshot: StudioSnapshot<C>) => void }): EditHistory {
  const [history, setHistory] = useState<History<StudioSnapshot<C>>>(() =>
    initHistory({ verses, selectedIndex, config })
  );
  // The undo/redo callbacks read the history without being rebuilt by it, so
  // they stay stable for the key handler that holds them.
  const historyRef = useRef(history);
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  useEffect(() => {
    const { present } = historyRef.current;
    const edited = verses !== present.verses || config !== present.config;
    if (!edited && selectedIndex === present.selectedIndex) return;

    const snapshot = { verses, selectedIndex, config };
    const next = edited
      ? record(historyRef.current, snapshot, { at: Date.now() })
      : replacePresent(historyRef.current, snapshot);
    historyRef.current = next;
    setHistory(next);
  }, [verses, selectedIndex, config]);

  const step = useCallback((move: (h: History<StudioSnapshot<C>>) => History<StudioSnapshot<C>>) => {
    const next = move(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    restoreRef.current(next.present);
  }, []);

  return {
    undo: useCallback(() => step(undoHistory), [step]),
    redo: useCallback(() => step(redoHistory), [step]),
    canUndo: canUndo(history),
    canRedo: canRedo(history)
  };
}
