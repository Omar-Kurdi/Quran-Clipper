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
    .map(arabic => ({ arabic, transliteration: '', translation: '', excluded: false }));
}

/**
 * Sets one edge of a segment.
 *
 * Moving the end cascades through the following segments so the timeline stays
 * contiguous; moving the start only trims this segment, since pushing
 * everything earlier would fight whatever the previous segment's end was
 * deliberately set to.
 */
export function setBoundary(
  verses: VerseData[],
  index: number,
  edge: 'startTime' | 'endTime',
  value: number,
  audioDuration: number
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

  const newEnd = Math.max(
    verse.startTime + MIN_SEGMENT,
    Math.min(audioDuration || 9999, round1(value))
  );
  updated[index] = { ...verse, endTime: newEnd };
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
  audioDuration: number
): VerseData[] {
  const verse = verses[index];
  if (!verse) return verses;
  return setBoundary(verses, index, edge, verse[edge] + delta, audioDuration);
}

/**
 * Marks the current playback position as the end of `index`, and hands the
 * remainder to the next segment. This is what SPACEBAR does.
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
  field: 'textUthmani' | 'transliteration' | 'translation',
  value: string
): VerseData[] {
  const updated = [...verses];
  const current = updated[index];
  if (!current) return verses;

  if (field === 'textUthmani') {
    updated[index] = {
      ...current,
      textUthmani: value,
      displayTextUthmani: value,
      words: value.split(/\s+/).filter(Boolean).map(arabic => ({
        arabic, transliteration: '', translation: '', excluded: false
      }))
    };
  } else if (field === 'transliteration') {
    updated[index] = { ...current, transliteration: value, displayTransliteration: value };
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
    transliteration: 'New verse transliteration',
    translation: 'New verse translation',
    startTime: startT,
    endTime: startT + 5.0,
    words: text.split(/\s+/).map(arabic => ({ arabic, transliteration: '', translation: '', excluded: false })),
    displayTextUthmani: text,
    displayTransliteration: 'New verse transliteration',
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
