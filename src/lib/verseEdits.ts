/**
 * Timeline edits, as pure functions.
 *
 * These used to live inside TimelineSyncEditor. In the editor layout the same
 * operations are reachable from two places -- dragging a block on the timeline
 * and typing in the inspector -- so they cannot belong to either component.
 * Every function takes the verse list and returns a new one; none of them
 * mutate, and the rounding rules are kept identical to the originals so
 * existing projects behave the same.
 */

import { VerseData, VerseWord, SURAHS_LIST } from '@/lib/quranData';

/** Timeline values are stored to one decimal; keeping that in one place stops drift. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The shortest a segment is allowed to get, in seconds. */
export const MIN_SEGMENT = 0.2;

export function ensureWords(verse: VerseData): VerseWord[] {
  if (verse.words?.length) return verse.words;
  return verse.textUthmani
    .split(/\s+/)
    .filter(Boolean)
    .map(arabic => ({ arabic, translation: '', excluded: false }));
}

/**
 * Sets one edge of a segment.
 *
 * `ripple` decides what happens to everything after it, and the two modes are
 * for different jobs.
 *
 * Rippling (the default, and how this behaved before the flag existed) keeps
 * the timeline packed: moving an end re-seats every following segment
 * back-to-back, each keeping its own length. That is what you want after
 * changing something early on -- one drag carries the whole timeline with it
 * instead of re-dragging twenty blocks.
 *
 * It is the wrong tool for fixing one boundary, which is what made it worth a
 * flag. Shortening a segment dragged everything after it earlier, and worse:
 * pushing a start to the right to open a deliberate gap, then extending the
 * previous segment's end into that gap, re-seated the segment you had just
 * moved and closed the gap again. With `ripple` off an edge moves alone, and
 * an end can be dragged up to -- never past -- wherever the next segment now
 * begins.
 *
 * Moving a start never ripples in either mode: pushing everything earlier
 * would fight whatever the previous segment's end was deliberately set to.
 */
export function setBoundary(
  verses: VerseData[],
  index: number,
  edge: 'startTime' | 'endTime',
  value: number,
  audioDuration: number,
  ripple: boolean = true
): VerseData[] {
  const updated = [...verses];
  const verse = updated[index];
  if (!verse) return verses;

  if (edge === 'startTime') {
    const floor = index > 0 ? updated[index - 1].endTime : 0;
    updated[index] = {
      ...verse,
      startTime: Math.max(floor, Math.min(verse.endTime - MIN_SEGMENT, round1(value)))
    };
    return updated;
  }

  // Without rippling, the next segment is a wall rather than something to
  // push: an end may reach it exactly and stop. The floor is applied last so
  // it wins outright -- a next segment already closer than MIN_SEGMENT (which
  // a split or a reorder can produce) would otherwise have the two clamps
  // fighting and invert the segment.
  const next = ripple ? undefined : updated[index + 1];
  const ceiling = Math.min(
    audioDuration || 9999,
    next ? next.startTime : Number.POSITIVE_INFINITY
  );
  const newEnd = Math.max(verse.startTime + MIN_SEGMENT, Math.min(ceiling, round1(value)));

  updated[index] = { ...verse, endTime: newEnd };
  if (!ripple) return updated;

  for (let i = index + 1; i < updated.length; i++) {
    const prevEnd = updated[i - 1].endTime;
    const duration = Math.max(MIN_SEGMENT, updated[i].endTime - updated[i].startTime);
    updated[i] = {
      ...updated[i],
      startTime: round1(prevEnd),
      endTime: round1(prevEnd + duration)
    };
  }
  return updated;
}

export function nudgeBoundary(
  verses: VerseData[],
  index: number,
  edge: 'startTime' | 'endTime',
  delta: number,
  audioDuration: number,
  ripple: boolean = true
): VerseData[] {
  const verse = verses[index];
  if (!verse) return verses;
  // The inspector's arrows and a drag on the timeline are the same edit, so
  // the flag has to reach both or the two disagree about what a nudge means.
  return setBoundary(verses, index, edge, verse[edge] + delta, audioDuration, ripple);
}

/**
 * Marks the current playback position as the end of `index`, and hands the
 * remainder to the next segment. This is what the B key does.
 */
export function markBoundaryAt(verses: VerseData[], index: number, atTime: number): VerseData[] | null {
  if (index >= verses.length) return null;
  const updated = [...verses];
  const markTime = round1(atTime);
  // Reject marks that would create a zero or negative duration segment.
  if (markTime <= updated[index].startTime) return null;
  updated[index] = { ...updated[index], endTime: markTime };
  if (index + 1 < updated.length) {
    updated[index + 1] = { ...updated[index + 1], startTime: markTime };
  }
  return updated;
}

/**
 * Reorders segments, then relays the timeline from the earliest start so the
 * new order is actually reflected in playback -- each segment keeps its own
 * duration but is re-seated back-to-back in the new sequence.
 */
export function reorder(verses: VerseData[], from: number, to: number): VerseData[] {
  if (from === to || to < 0 || to >= verses.length) return verses;
  const updated = [...verses];
  const [moved] = updated.splice(from, 1);
  updated.splice(to, 0, moved);

  let cursor = Math.min(...verses.map(v => v.startTime));
  for (let i = 0; i < updated.length; i++) {
    const duration = Math.max(MIN_SEGMENT, updated[i].endTime - updated[i].startTime);
    updated[i] = { ...updated[i], startTime: round1(cursor), endTime: round1(cursor + duration) };
    cursor += duration;
  }
  return updated;
}

export function setText(
  verses: VerseData[],
  index: number,
  field: 'textUthmani' | 'translation',
  value: string
): VerseData[] {
  const updated = [...verses];
  const current = updated[index];
  if (!current) return verses;

  if (field === 'textUthmani') {
    // Retyping the Arabic drops any measured word times with the old words,
    // because they described words that are no longer there. Splitting this
    // segment afterwards falls back to dividing by pace, which is what
    // `splitSegment` does whenever the times are missing or stale.
    updated[index] = {
      ...current,
      textUthmani: value,
      displayTextUthmani: value,
      words: value.split(/\s+/).filter(Boolean).map(arabic => ({
        arabic, translation: '', excluded: false
      }))
    };
  } else {
    updated[index] = { ...current, translation: value, displayTranslation: value };
  }
  return updated;
}

export function setVerseNumber(verses: VerseData[], index: number, value: number): VerseData[] {
  const updated = [...verses];
  const current = updated[index];
  if (!current) return verses;
  const currentSurah = current.verseKey.split(':')[0] || '1';
  const verseNumber = Math.max(1, Math.round(value || current.verseNumber));
  updated[index] = { ...current, verseNumber, verseKey: `${currentSurah}:${verseNumber}` };
  return updated;
}

export function toggleWord(verses: VerseData[], verseIndex: number, wordIndex: number): VerseData[] {
  const updated = [...verses];
  const words = ensureWords(updated[verseIndex]).map((word, idx) =>
    idx === wordIndex ? { ...word, excluded: !word.excluded } : word
  );
  const displayTextUthmani = words.filter(w => !w.excluded).map(w => w.arabic).join(' ');
  updated[verseIndex] = { ...updated[verseIndex], words, displayTextUthmani };
  return updated;
}

/**
 * Inserts a new segment after `anchorIndex`, deriving the surah and next ayah
 * from that anchor rather than assuming Surah 1 -- which used to produce
 * invalid keys like "1:24" when the timeline was in a different surah.
 */
export function addVerseAfter(verses: VerseData[], anchorIndex: number): { verses: VerseData[]; insertedAt: number } {
  const anchor = verses[anchorIndex] ?? verses[verses.length - 1];
  const [anchorSurahStr] = (anchor?.verseKey || '1:1').split(':');
  let surahNumber = Math.max(1, parseInt(anchorSurahStr, 10) || 1);
  let nextNum = (anchor ? anchor.verseNumber : 0) + 1;

  const surahMeta = SURAHS_LIST.find(s => s.number === surahNumber);
  if (surahMeta && nextNum > surahMeta.numberOfAyahs) {
    // Ran past this surah's last ayah -- continue into the next surah rather
    // than producing an ayah number that does not exist.
    surahNumber = Math.min(114, surahNumber + 1);
    nextNum = 1;
  }

  const text = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
  const startT = anchor ? anchor.endTime : 0;
  const newVerse: VerseData = {
    verseNumber: nextNum,
    verseKey: `${surahNumber}:${nextNum}`,
    textUthmani: text,
    translation: 'New verse translation',
    startTime: startT,
    endTime: startT + 5.0,
    words: text.split(/\s+/).map(arabic => ({ arabic, translation: '', excluded: false })),
    displayTextUthmani: text,
    displayTranslation: 'New verse translation'
  };

  const insertAt = (verses[anchorIndex] ? anchorIndex : verses.length - 1) + 1;
  return {
    verses: [...verses.slice(0, insertAt), newVerse, ...verses.slice(insertAt)],
    insertedAt: insertAt
  };
}

/** Removes a segment and closes the gap it leaves. Never removes the last one. */
export function removeVerse(verses: VerseData[], index: number): VerseData[] {
  if (verses.length <= 1) return verses;
  const removed = verses[index];
  const removedDuration = Math.max(0, removed.endTime - removed.startTime);
  return verses
    .filter((_, i) => i !== index)
    .map((verse, i) => {
      if (i < index) return verse;
      return {
        ...verse,
        startTime: Math.max(0, round1(verse.startTime - removedDuration)),
        endTime: Math.max(0, round1(verse.endTime - removedDuration))
      };
    });
}

/** Duplicates a segment directly after itself, pushing everything later along. */
export function duplicateVerse(verses: VerseData[], index: number, audioDuration: number): VerseData[] {
  const source = verses[index];
  if (!source) return verses;
  const duration = Math.max(0.8, source.endTime - source.startTime || 3);
  const duplicated: VerseData = {
    ...source,
    startTime: source.endTime,
    endTime: Math.min(audioDuration || source.endTime + duration, source.endTime + duration),
    words: source.words?.map(w => ({ ...w }))
  };
  const updated = [...verses.slice(0, index + 1), duplicated, ...verses.slice(index + 1)];
  for (let i = index + 2; i < updated.length; i++) {
    updated[i] = {
      ...updated[i],
      startTime: round1(updated[i].startTime + duration),
      endTime: round1(updated[i].endTime + duration)
    };
  }
  return updated;
}

/**
 * Cuts one segment in two at `atTime`.
 *
 * The escape hatch for segmentation the aligner got wrong. Automatic
 * segmentation has to decide whether a given silence ends a phrase, and some
 * of those calls are genuinely undecidable from the audio -- a ghunnah and a
 * held breath measure the same. Rather than chase the last few percent, this
 * makes a wrong call a two-second fix.
 *
 * Both halves keep the ayah: a caption never spans one, so a split is always
 * within a single verse and both sides carry the same key.
 *
 * Which words fall on which side comes from `VerseWord.timestamp` when the
 * provider measured it -- forced alignment does, so the cut lands between the
 * words actually either side of `atTime`. Gemini never supplies word times, and
 * neither does a caption typed by hand, so the fallback divides the words by
 * where `atTime` falls in the segment. That assumes an even pace and often will
 * not be exactly right, which is tolerable because the user is splitting while
 * listening and can toggle a word either way.
 */
export function splitSegment(verses: VerseData[], index: number, atTime: number): VerseData[] {
  const verse = verses[index];
  if (!verse) return verses;

  const cut = round1(atTime);
  // Refusing rather than clamping: a split that would leave either side too
  // short to be a caption is a mis-click, and silently making one 0.2s long is
  // worse than doing nothing.
  if (cut <= verse.startTime + MIN_SEGMENT || cut >= verse.endTime - MIN_SEGMENT) return verses;

  const words = ensureWords(verse);
  const span = verse.endTime - verse.startTime;

  // Only the words on screen were spoken during this segment, so only they can
  // carry times -- requiring every word to have one could never pass, because
  // the excluded ones belong to a different part of the ayah.
  //
  // A time is trusted only while it still lies inside the segment. Reordering
  // the timeline re-seats segments at new times without moving the words, so a
  // stale timestamp would otherwise cut in a place that has nothing to do with
  // the audio. Out-of-range times fall back to dividing by pace, which is what
  // this did before word times existed.
  const spoken = words.filter(word => !word.excluded);
  const measured =
    spoken.length > 0 &&
    spoken.every(
      word =>
        typeof word.timestamp === 'number' &&
        word.timestamp >= verse.startTime - MIN_SEGMENT &&
        word.timestamp <= verse.endTime + MIN_SEGMENT
    );

  let at: number;
  if (measured) {
    const found = words.findIndex(
      word => !word.excluded && (word.timestamp as number) >= cut
    );
    at = found === -1 ? words.length - 1 : found;
  } else {
    at = Math.round(((cut - verse.startTime) / span) * words.length);
  }
  // Every caption needs at least one word, so neither side may be empty.
  at = Math.max(1, Math.min(words.length - 1, at));

  const shown = (list: VerseWord[]) => list.filter(word => !word.excluded).map(word => word.arabic).join(' ');
  const head = words.slice(0, at).map(word => ({ ...word }));
  const tail = words.slice(at).map(word => ({ ...word }));

  return [
    ...verses.slice(0, index),
    { ...verse, endTime: cut, words: head, displayTextUthmani: shown(head) },
    { ...verse, startTime: cut, words: tail, displayTextUthmani: shown(tail) },
    ...verses.slice(index + 1),
  ];
}

/**
 * Joins a segment to the one after it.
 *
 * The other half of the escape hatch: where automatic segmentation split a
 * phrase the reciter ran straight through, this puts it back. The merged
 * caption spans both times and shows both sets of words in order.
 *
 * Only within one ayah. A caption that spanned two would have no single verse
 * key to carry, and every consumer -- the badge, the export naming, the word
 * highlighting -- assumes it has one.
 */
export function mergeWithNext(verses: VerseData[], index: number): VerseData[] {
  const first = verses[index];
  const second = verses[index + 1];
  if (!first || !second || first.verseKey !== second.verseKey) return verses;

  const words = [...ensureWords(first), ...ensureWords(second)].map(word => ({ ...word }));
  const merged: VerseData = {
    ...first,
    endTime: Math.max(first.endTime, second.endTime),
    words,
    displayTextUthmani: words.filter(word => !word.excluded).map(word => word.arabic).join(' '),
  };
  return [...verses.slice(0, index), merged, ...verses.slice(index + 2)];
}


/** Index of the segment covering `time`, or the last one that started before it. */
export function segmentAt(verses: VerseData[], time: number): number {
  let idx = 0;
  for (let i = 0; i < verses.length; i++) {
    if (time >= verses[i].startTime) idx = i;
  }
  return idx;
}

/** `12.4s` under a minute, `2:05.30` over it -- long recitations need the minutes. */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) return `${safe.toFixed(1)}s`;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
