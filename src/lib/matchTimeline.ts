/**
 * Provider-agnostic timeline building.
 *
 * Both the Gemini matcher and the local ASR aligner produce the same
 * `MatchSegment[]` shape (see `matchTypes.ts`). Everything from here on —
 * fetching verse text, deciding which words are actually on-screen, keeping
 * the timeline contiguous — is shared so the two providers can't drift apart.
 */

import { SURAHS_LIST, VerseData, VerseWord } from '@/lib/quranData';
import { normalizeArabic } from '@/lib/arabic';
import { getVerseByKey } from '@/lib/quranCorpus';
import type { MatchSegment } from '@/lib/matchTypes';

/**
 * Marks which of a verse's words were actually recited in this segment.
 *
 * Walks both word lists in order (not a set-membership check) so repeated
 * words are handled correctly -- e.g. if "الله" appears three times in an
 * ayah but only the second occurrence was actually recited in this segment,
 * only that occurrence gets included. A small lookahead tolerates minor
 * word-level differences (mainly from the Gemini provider, which generates
 * displayTextUthmani itself rather than slicing it from the canonical text).
 */
export function buildSegmentWords(words: VerseWord[], displayTextUthmani: string): VerseWord[] {
  const normalizedDisplay = normalizeArabic(displayTextUthmani);
  if (!normalizedDisplay) return words.map(word => ({ ...word, excluded: false }));

  const displayWords = normalizedDisplay.split(/\s+/).filter(Boolean);
  const LOOKAHEAD = 2;
  let displayIdx = 0;

  return words.map(word => {
    const normalizedWord = normalizeArabic(word.arabic);
    if (!normalizedWord) return { ...word, excluded: false };

    for (let offset = 0; offset <= LOOKAHEAD && displayIdx + offset < displayWords.length; offset++) {
      const dw = displayWords[displayIdx + offset];
      // Substring matching is only safe above ~3 chars. Below that, short
      // function words (ما, من, لا) are a substring of nearly everything,
      // which was marking them as recited whenever *any* nearby word matched.
      const longEnough = normalizedWord.length >= 3 && dw.length >= 3;
      const isMatch = dw === normalizedWord || (longEnough && (dw.includes(normalizedWord) || normalizedWord.includes(dw)));
      if (isMatch) {
        displayIdx += offset + 1;
        return { ...word, excluded: false };
      }
    }
    return { ...word, excluded: true };
  });
}

export function parseVerseKey(segment: MatchSegment, selectedSurah: number): string | null {
  if (segment.verseKey && /^\d+:\d+$/.test(segment.verseKey)) return segment.verseKey;
  const surahNumber = Number(segment.surahNumber || selectedSurah);
  const verseNumber = Number(segment.verseNumber);
  if (Number.isFinite(surahNumber) && Number.isFinite(verseNumber) && verseNumber > 0) return `${surahNumber}:${verseNumber}`;
  return null;
}

export function estimateDurationFromSegments(segments: MatchSegment[] = []): number {
  return Math.max(0, ...segments.map(segment => Number(segment.endTime) || 0));
}

export function getPrimaryTimelineSummary(segments: MatchSegment[], selectedSurah: number) {
  const keys = segments.map(segment => parseVerseKey(segment, selectedSurah)).filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    const surahMeta = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];
    return {
      surahNumber: selectedSurah,
      surahNameArabic: surahMeta.nameArabic,
      surahNameEnglish: surahMeta.nameEnglish,
      ayahStart: 1,
      ayahEnd: Math.min(7, surahMeta.numberOfAyahs),
      timelineTitle: surahMeta.nameEnglish
    };
  }
  const first = keys[0];
  const last = keys[keys.length - 1];
  const firstSurah = parseInt(first.split(':')[0], 10);
  const firstAyah = parseInt(first.split(':')[1], 10);
  const lastAyah = parseInt(last.split(':')[1], 10);
  const uniqueSurahs = Array.from(new Set(keys.map(key => parseInt(key.split(':')[0], 10))));
  const firstSurahMeta = SURAHS_LIST.find(s => s.number === firstSurah) || SURAHS_LIST[0];
  const timelineTitle =
    uniqueSurahs.length === 1 ? `${firstSurahMeta.nameEnglish} ${firstAyah}-${lastAyah}` : `Matched Quran Timeline (${uniqueSurahs.length} surahs)`;
  return {
    surahNumber: firstSurah,
    surahNameArabic: uniqueSurahs.length === 1 ? firstSurahMeta.nameArabic : 'تلاوة متعددة السور',
    surahNameEnglish: timelineTitle,
    ayahStart: firstAyah,
    ayahEnd: uniqueSurahs.length === 1 ? lastAyah : firstAyah,
    timelineTitle
  };
}

/** Resolves each segment's verse text (via the shared corpus cache) and builds VerseData rows. */
export async function fetchVersesByDetectedSegments(params: {
  segments: MatchSegment[];
  selectedSurah: number;
  audioDuration: number;
}): Promise<VerseData[]> {
  const verseCache = new Map<string, VerseData>();
  const timeline: VerseData[] = [];

  for (let index = 0; index < params.segments.length; index++) {
    const segment = params.segments[index];
    const verseKey = parseVerseKey(segment, params.selectedSurah);
    if (!verseKey) continue;

    if (!verseCache.has(verseKey)) {
      const corpusVerse = await getVerseByKey(verseKey);
      if (!corpusVerse) continue;
      verseCache.set(verseKey, {
        verseNumber: corpusVerse.verseNumber,
        verseKey: corpusVerse.verseKey,
        textUthmani: corpusVerse.textUthmani,
        transliteration: corpusVerse.transliteration,
        translation: corpusVerse.translation,
        startTime: 0,
        endTime: 0,
        words: corpusVerse.words
      });
    }
    const baseVerse = verseCache.get(verseKey);
    if (!baseVerse) continue;

    const startTime = Math.max(0, Math.round(Number(segment.startTime ?? 0) * 10) / 10);
    const fallbackEnd =
      index + 1 < params.segments.length
        ? Number(params.segments[index + 1].startTime ?? startTime + 3)
        : params.audioDuration || startTime + 3;
    const endTime = Math.max(startTime + 0.4, Math.round(Number(segment.endTime ?? fallbackEnd) * 10) / 10);
    const displayTextUthmani = (segment.displayTextUthmani || segment.recitedTextUthmani || '').trim();
    const segmentDisplayText = displayTextUthmani || baseVerse.textUthmani;

    // Prefer an exact word range when the provider supplied one. Text matching
    // is only a fallback for providers that can't say which words they meant.
    const hasRange =
      typeof segment.startWordIndex === 'number' && typeof segment.endWordIndex === 'number';
    const segmentWords = !baseVerse.words?.length
      ? baseVerse.words
      : hasRange
        ? baseVerse.words.map((word, wordIdx) => ({
            ...word,
            excluded: wordIdx < segment.startWordIndex! || wordIdx > segment.endWordIndex!
          }))
        : buildSegmentWords(baseVerse.words, segmentDisplayText);

    timeline.push({
      ...baseVerse,
      verseKey,
      startTime,
      endTime,
      words: segmentWords,
      matchConfidence: Math.max(0, Math.min(1, Number(segment.confidence ?? 0.65))),
      displayTextUthmani: segmentDisplayText,
      displayTransliteration: segment.displayTransliteration || '',
      displayTranslation: segment.displayTranslation || ''
    });
  }
  return timeline;
}

/**
 * Sorts by start time, squeezes out overlaps/gaps, and keeps the whole timeline
 * inside the audio.
 *
 * The clamp is there because a provider can return times past the end of the
 * file: Gemini estimates duration rather than measuring it, and on the test
 * clip put the final segment at 48.3-108.0s in a 68.5s recording. Segments
 * beyond the end would simply never display. When `audioDuration` was itself
 * derived from the segments the clamp is a no-op, so it only ever tightens a
 * timeline against a real measurement.
 */
export function enforceTimelineOrder(verses: VerseData[], audioDuration: number): VerseData[] {
  const limit = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : Infinity;
  const sorted = [...verses]
    .sort((a, b) => a.startTime - b.startTime)
    // A segment starting after the audio ends has no time to occupy at all.
    .filter(verse => verse.startTime < limit);

  if (sorted.length < verses.length) {
    console.warn(`[matchTimeline] dropped ${verses.length - sorted.length} segment(s) starting past the end of the audio (${limit}s).`);
  }

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].endTime > limit) {
      console.warn(
        `[matchTimeline] ${sorted[i].verseKey} ends at ${sorted[i].endTime}s, past the ${limit}s audio -- clamping.`
      );
      sorted[i].endTime = limit;
    }
    sorted[i].startTime = Math.max(0, Math.round(sorted[i].startTime * 10) / 10);
    if (i > 0 && sorted[i].startTime < sorted[i - 1].endTime) {
      // The provider gave us overlapping segments -- most often two Gemini
      // segments whose guessed timestamps disagree. Shortening the earlier
      // one keeps the timeline playable, but it's silently editing the
      // provider's output, so surface it rather than letting it vanish.
      console.warn(
        `[matchTimeline] overlap: ${sorted[i - 1].verseKey} end ${sorted[i - 1].endTime}s > ` +
          `${sorted[i].verseKey} start ${sorted[i].startTime}s -- truncating the earlier segment.`
      );
      sorted[i - 1].endTime = sorted[i].startTime;
    }
    if (sorted[i].endTime <= sorted[i].startTime) {
      sorted[i].endTime = Math.min(audioDuration || sorted[i].startTime + 3, sorted[i].startTime + 0.8);
    }
    sorted[i].endTime = Math.round(sorted[i].endTime * 10) / 10;
  }
  return sorted;
}

/**
 * Clips a timeline to a trimmed audio window and rebases times to the new
 * clip's start (so segment 0 still starts at/near 0, matching every other
 * consumer's assumption about where the audio begins).
 *
 * Segments entirely outside the window are dropped. A segment that straddles
 * a trim boundary is clamped rather than dropped, so cutting mid-ayah keeps
 * the part of it that survived instead of losing the whole verse.
 */
export function trimTimeline(verses: VerseData[], trimStart: number, trimEnd: number): VerseData[] {
  return verses
    .filter(verse => verse.endTime > trimStart && verse.startTime < trimEnd)
    .map(verse => {
      const startTime = Math.round((Math.max(verse.startTime, trimStart) - trimStart) * 10) / 10;
      const endTime = Math.round((Math.min(verse.endTime, trimEnd) - trimStart) * 10) / 10;
      return { ...verse, startTime, endTime: Math.max(endTime, startTime + 0.1) };
    });
}
