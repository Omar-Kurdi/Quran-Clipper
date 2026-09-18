/**
 * Translation text and the list of editions that still exist, server side.
 *
 * Shared by `/api/quran/translation`, which the studio asks when a language is
 * chosen, and by the content sync, which asks the same question on a schedule.
 * One implementation, so a sync cannot disagree with what the picker would
 * have fetched.
 */

import { quranApiJson } from './quranApi';
import { cleanHtml } from './quranCorpus';
import { localSurah, localEditions } from './localTranslations';

interface ApiVerse {
  verse_key?: string;
  verse_number?: number;
  translations?: { resource_id?: number; text?: string }[];
}

/** `{ "2:255": { "20": "…", "85": "…" } }` -- by verse key, then by edition id. */
export type TranslationTexts = Record<string, Record<string, string>>;

/**
 * Fills in any requested edition this machine holds a copy of.
 *
 * Applied after the upstream rather than instead of it, so an upstream that
 * carries the edition is preferred. Written from the *local* surah's own
 * length rather than from the response, because the response may hold no
 * verses at all -- an upstream asked only for an edition it does not serve
 * comes back empty, which is the case this exists for.
 */
function fillLocal(into: TranslationTexts, surah: number, start: number, end: number, ids: string[]): TranslationTexts {
  for (const id of ids) {
    const local = localSurah(id, surah) || [];
    for (let ayah = Math.max(1, start); ayah <= Math.min(end, local.length); ayah++) {
      const text = local[ayah - 1];
      const key = `${surah}:${ayah}`;
      if (text && !into[key]?.[id]) into[key] = { ...into[key], [id]: text };
    }
  }
  return into;
}

/** An upstream answer, reduced to the texts of ayahs `start`..`end` by verse key and id. */
function textsFromResponse(list: ApiVerse[], start: number, end: number): TranslationTexts {
  const verses: TranslationTexts = {};
  for (const verse of list) {
    const number = verse.verse_number ?? 0;
    if (!verse.verse_key || number < start || number > end) continue;
    const texts: Record<string, string> = {};
    for (const translation of verse.translations || []) {
      const text = typeof translation?.resource_id === 'number' ? cleanHtml(translation.text || '') : '';
      if (text) texts[String(translation.resource_id)] = text;
    }
    if (Object.keys(texts).length) verses[verse.verse_key] = texts;
  }
  return verses;
}

/**
 * The text of `ids` for ayahs `start`..`end` of one surah, or null when the
 * upstream could not answer and nothing was held locally either.
 *
 * An id the upstream no longer serves simply does not come back; the caller
 * decides what that means.
 */
export async function fetchTranslationTexts(
  surah: number,
  start: number,
  end: number,
  ids: string[]
): Promise<TranslationTexts | null> {
  // Through `quranApiJson` with an acceptance test, not a bare fetch. The
  // Quran Foundation's pre-live sandbox answers 200 for chapters it holds
  // without carrying the translation asked for, which read as "the extra
  // translation is broken for Al-Fatihah" rather than as an upstream that
  // should have been passed over. An answer without a single requested id is
  // not an answer.
  const requested = new Set(ids);
  const { data } = await quranApiJson<{ verses?: ApiVerse[] }>(
    `/verses/by_chapter/${surah}?translations=${ids.join(',')}&fields=verse_key&per_page=300`,
    { next: { revalidate: 86400 } },
    body =>
      (body.verses || []).some(verse =>
        (verse.translations || []).some(entry => entry?.text && requested.has(String(entry.resource_id)))
      )
  );

  // A failed upstream still leaves a local edition answerable, which is the
  // difference between a caption in one language and no caption at all.
  if (!data) {
    const local = fillLocal({}, surah, start, end, ids);
    return Object.keys(local).length ? local : null;
  }
  const list = Array.isArray(data.verses) ? data.verses : [];
  return fillLocal(textsFromResponse(list, start, end), surah, start, end, ids);
}

/**
 * Every edition id still served anywhere this studio reads from, or null when
 * neither upstream could be asked.
 *
 * The union of the configured upstream, the open API and this machine's own
 * editions -- deliberately generous, because what it decides is deletion. The
 * Foundation's pre-live sandbox lists fourteen editions; reading its list
 * alone would "delete" every other translation from every saved project.
 * An id is gone only when nobody serves it.
 */
export async function availableTranslationIds(): Promise<Set<string> | null> {
  type Catalogue = { translations?: { id?: number }[] };
  const idsOf = (body: Catalogue | null) =>
    (body?.translations || []).map(item => item?.id).filter((id): id is number => typeof id === 'number').map(String);

  const [configured, open] = await Promise.all([
    quranApiJson<Catalogue>('/resources/translations', { next: { revalidate: 86400 } })
      .then(result => result.data)
      .catch(() => null),
    // A fixed address, spelled out: this is the open API specifically, whichever
    // upstream is configured.
    fetch('https://api.quran.com/api/v4/resources/translations', { next: { revalidate: 86400 } } as RequestInit)
      .then(res => (res.ok ? (res.json() as Promise<Catalogue>) : null))
      .catch(() => null)
  ]);
  if (!configured && !open) return null;

  const ids = new Set<string>([...idsOf(configured), ...idsOf(open)]);
  // An empty list is an upstream fault, not a world with no translations in it.
  if (!ids.size) return null;
  for (const edition of localEditions()) ids.add(edition.id);
  return ids;
}
