/**
 * Clips suggested from a recording's ayah map, for picking a recording's
 * clips at once rather than finding each by hand: whole sections of the
 * surah -- its topic groups, each with its topic, or else its rukus, the
 * mushaf's own sections -- split where one is too long; otherwise its ayahs, in
 * order, grouped into runs about as long as asked, each ending where the
 * reciter pauses longest near that length.
 *
 * No run is longer than a Short can be. An ayah longer than that on its own
 * is a run of its own; the platforms' readout says where it will not fit.
 */

import type { VerseData } from './quranData';
import { ayahList, ayahWindow } from './recordingClips';

/** The lengths offered, in seconds: Reels-short to a full three-minute Short. */
export const SUGGESTION_TARGETS = [30, 60, 90, 180] as const;
/** As long as a YouTube Short may be; no suggestion is longer. */
export const MAX_SUGGESTION_SEC = 180;

export interface Suggestion {
  /** The first and last ayah, as keys. */
  from: string;
  to: string;
  /** Its stretch of the recording, opened and closed in the pauses around it. */
  start: number;
  end: number;
  /**
   * The section of the surah it is, of how many: a topic group with its topic,
   * or a ruku -- the mushaf's own sections, each a passage whole in its
   * meaning -- and, where one was too long for a clip and split, which part.
   * Absent where neither is known.
   */
  section?: { kind: SectionKind; number: number; of: number; title?: string; part?: number; parts?: number };
}

/** What a surah's sections are: topic groups, each with its topic where one is known, or rukus. */
export type SectionKind = 'topic' | 'ruku';
/** One section of a surah: its first ayah, and its topic where it has one. */
export interface SurahSection {
  first: number;
  title?: string;
}

/**
 * A surah's sections from its topic groups (`[first, last, topic]`, in
 * order): each group a section, and any ayahs no group covers a section of
 * their own with no topic, so every ayah is in one.
 */
export function topicSections(groups: readonly (readonly [number, number, string])[]): SurahSection[] {
  const sections: SurahSection[] = [];
  let next = 1;
  for (const [first, last, title] of groups) {
    if (first < next) continue;
    if (first > next) sections.push({ first: next });
    sections.push({ first, title });
    next = last + 1;
  }
  return sections;
}

type Ayah = { key: string; first: number; last: number; start: number; end: number; opens: string };

/**
 * Whether an ayah opens by carrying on from the one before -- «فَ», «ثُمَّ»,
 * «بَلْ» -- and so is a poor place for a clip to start: heard alone it answers
 * something the clip left out.
 */
export function carriesOn(text: string): boolean {
  const first = (text.trim().split(/\s+/)[0] || '').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '');
  return first === 'ثم' || first === 'بل' || /^ف/.test(first);
}

/**
 * Whole ayahs `ayahs[from..to]` grouped into runs about `target` long: each
 * takes the ayahs that bring it closest, a longer pause after counting in its
 * favour as an end and an ayah that carries on from the one before against it
 * as the next one's start, never past `limit` unless one ayah alone is.
 */
function runsOf(ayahs: Ayah[], from: number, to: number, target: number, limit: number): [number, number][] {
  const pauseAfter = (i: number) => (i + 1 < ayahs.length ? Math.max(0, ayahs[i + 1].start - ayahs[i].end) : 2);
  const out: [number, number][] = [];
  for (let i = from; i <= to;) {
    let best = i;
    let bestScore = Infinity;
    for (let j = i; j <= to; j++) {
      const length = ayahs[j].end - ayahs[i].start;
      if (j > i && length > limit) break;
      // How far from the length asked, less a little for ending on a long pause, more for leaving the next to start mid-thought.
      const nextCarriesOn = j < to && carriesOn(ayahs[j + 1].opens) ? 0.5 : 0;
      const score = Math.abs(length - target) / target - Math.min(pauseAfter(j), 2) * 0.1 + nextCarriesOn;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    out.push([i, best]);
    i = best + 1;
  }
  return out;
}

/** The ayahs' sections, as runs of indexes: each ayah in the section its number falls in, one not numbered (a basmala) in the next one's. */
function sectionRuns(ayahs: Ayah[], starts: readonly number[]): { number: number; from: number; to: number }[] {
  const numberOf = (i: number): number => {
    const ayah = Number(ayahs[i].key.split(':')[1]);
    if (!Number.isFinite(ayah)) return i + 1 < ayahs.length ? numberOf(i + 1) : starts.length;
    return starts.filter(first => first <= ayah).length || 1;
  };
  const runs: { number: number; from: number; to: number }[] = [];
  ayahs.forEach((_, i) => {
    const number = numberOf(i);
    const last = runs[runs.length - 1];
    if (last && last.number === number) last.to = i;
    else runs.push({ number, from: i, to: i });
  });
  return runs;
}

/**
 * The map's ayahs grouped into suggested clips about `target` seconds long,
 * never past `MAX_SUGGESTION_SEC` unless one ayah alone is.
 *
 * Given the surah's sections -- its topic groups, or its rukus -- a clip is a
 * whole section where one fits, so it holds a passage whole in its meaning
 * rather than whatever ayahs come to the length; one too long is split into
 * parts at ayahs that do not carry on from the one before, and sections
 * shorter than the length are joined. Without them, runs of ayahs about as
 * long as asked.
 */
export function suggestClips(
  map: VerseData[], target: number, duration: number, sections?: { kind: SectionKind; list: readonly SurahSection[] },
): Suggestion[] {
  const ayahs: Ayah[] = ayahList(map).map(ayah => ({
    ...ayah,
    start: map[ayah.first].startTime,
    end: map[ayah.last].endTime,
    opens: map[ayah.first].textUthmani || '',
  }));
  if (!ayahs.length) return [];
  const limit = Math.min(MAX_SUGGESTION_SEC, Math.max(target * 1.5, target + 10));
  const made = (from: number, to: number, section?: Suggestion['section']): Suggestion[] => {
    const window = ayahWindow(map, ayahs[from].first, ayahs[to].last, duration);
    return window ? [{ from: ayahs[from].key, to: ayahs[to].key, ...window, ...(section && { section }) }] : [];
  };
  if (!sections?.list.length) return runsOf(ayahs, 0, ayahs.length - 1, target, limit).flatMap(([from, to]) => made(from, to));

  const length = (from: number, to: number) => ayahs[to].end - ayahs[from].start;
  // Sections shorter than the length joined while together they still are not longer, their topics with them.
  const groups = sectionRuns(ayahs, sections.list.map(each => each.first)).reduce<{ number: number; from: number; to: number; titles: string[] }[]>((joined, run) => {
    const title = sections.list[run.number - 1]?.title;
    const last = joined[joined.length - 1];
    if (last && length(last.from, run.to) <= target) {
      last.to = run.to;
      if (title) last.titles.push(title);
    } else joined.push({ ...run, titles: title ? [title] : [] });
    return joined;
  }, []);
  const of = sections.list.length;
  return groups.flatMap(group => {
    const section = { kind: sections.kind, number: group.number, of, ...(group.titles.length && { title: group.titles.join(' · ') }) };
    if (length(group.from, group.to) <= limit) return made(group.from, group.to, section);
    const parts = runsOf(ayahs, group.from, group.to, target, limit);
    return parts.flatMap(([from, to], i) => made(from, to, { ...section, part: i + 1, parts: parts.length }));
  });
}

/** The first ayah of each ruku of a surah, from its verses' `ruku_number` as the Quran Foundation gives them. */
export function rukuStartsOf(verses: { verse_number?: number; ruku_number?: number }[]): number[] {
  const starts: number[] = [];
  let last: number | undefined;
  for (const verse of verses) {
    if (typeof verse.verse_number !== 'number' || typeof verse.ruku_number !== 'number') continue;
    if (verse.ruku_number !== last) starts.push(verse.verse_number);
    last = verse.ruku_number;
  }
  return starts;
}

/** A suggestion's name for ticking it: its first and last ayah. */
export const suggestionId = (suggestion: Pick<Suggestion, 'from' | 'to'>) => `${suggestion.from}-${suggestion.to}`;

/** Its ayahs as shown: `3:20` or `3:20–22`. */
export const suggestionLabel = (suggestion: Pick<Suggestion, 'from' | 'to'>) =>
  suggestion.from === suggestion.to ? suggestion.from : `${suggestion.from}–${suggestion.to.split(':')[1]}`;
