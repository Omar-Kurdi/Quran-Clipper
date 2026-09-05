'use client';

import { useCallback, useMemo, useState } from 'react';
import { VerseData } from '@/lib/quranData';
import {
  setBoundary, nudgeBoundary, markBoundaryAt, reorder, setText, setVerseNumber,
  toggleWord, addVerseAfter, removeVerse, duplicateVerse, splitSegment, mergeWithNext,
} from '@/lib/verseEdits';

/**
 * The timeline and which segment is selected, with every edit that acts on
 * them.
 *
 * The operations themselves are pure functions in `verseEdits`; what this adds
 * is the pairing of "apply the edit" with "keep the selection pointing
 * somewhere sensible afterwards", which was previously repeated inline at each
 * call site in the JSX. Splitting moves the selection to the new second half;
 * deleting steps back; adding follows the inserted segment. Getting one of
 * those wrong leaves the inspector describing a segment the user is not looking
 * at, which is subtle enough to ship unnoticed.
 *
 * Values the edit needs from elsewhere -- the length of the audio, where the
 * playhead is -- are passed per call rather than held here, so this hook does
 * not need to know the transport exists.
 */
export function useTimelineEditing(initial: VerseData[]) {
  const [verses, setVerses] = useState<VerseData[]>(initial);
  const [selectedIndex, setSelectedIndex] = useState(0);

  /** Applies an edit, ignoring it when the pure function declined to change anything. */
  const apply = useCallback((next: VerseData[], moveTo?: number) => {
    setVerses(current => (next === current ? current : next));
    if (typeof moveTo === 'number') setSelectedIndex(moveTo);
  }, []);

  const edit = useMemo(() => ({
    text: (field: 'textUthmani' | 'translation', value: string) =>
      apply(setText(verses, selectedIndex, field, value)),

    verseNumber: (value: number) => apply(setVerseNumber(verses, selectedIndex, value)),

    toggleWord: (wordIndex: number) => apply(toggleWord(verses, selectedIndex, wordIndex)),

    nudge: (edge: 'startTime' | 'endTime', delta: number, audioDuration: number, ripple = true) =>
      apply(nudgeBoundary(verses, selectedIndex, edge, delta, audioDuration, ripple)),

    boundary: (index: number, edge: 'startTime' | 'endTime', value: number, audioDuration: number, ripple = true) =>
      apply(setBoundary(verses, index, edge, value, audioDuration, ripple)),

    reorder: (to: number) =>
      apply(reorder(verses, selectedIndex, to), Math.max(0, Math.min(verses.length - 1, to))),

    duplicate: (audioDuration: number) => apply(duplicateVerse(verses, selectedIndex, audioDuration)),

    remove: () => apply(removeVerse(verses, selectedIndex), Math.max(0, selectedIndex - 1)),

    add: () => {
      const result = addVerseAfter(verses, selectedIndex);
      apply(result.verses, result.insertedAt);
    },

    /** Ends the selected segment at the playhead and hands the rest to the next. */
    markHere: (atTime: number) => {
      const next = markBoundaryAt(verses, selectedIndex, atTime);
      if (!next) return;
      apply(next, selectedIndex + 1 < next.length ? selectedIndex + 1 : selectedIndex);
    },

    /**
     * Selection follows the second half: the user split *here*, so here is what
     * they are looking at.
     */
    split: (atTime: number) => {
      const next = splitSegment(verses, selectedIndex, atTime);
      if (next === verses) return;
      apply(next, selectedIndex + 1);
    },

    merge: () => apply(mergeWithNext(verses, selectedIndex)),
  }), [verses, selectedIndex, apply]);

  return { verses, setVerses, selectedIndex, setSelectedIndex, edit };
}
