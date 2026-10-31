/**
 * A brief tafsir for each ayah, server side.
 *
 * One edition: Tafsir al-Muyassar, the King Fahd Complex's concise Arabic
 * tafsir, a sentence or two an ayah (Al-Mulk's run 50-190 characters). The
 * others the upstream serves are commentaries -- al-Sa'di's run to 800
 * characters an ayah, Ibn Kathir's to thousands -- which no caption can hold.
 *
 * Fetched when a caption is drawn and never stored: not in a project, not in
 * the auto-saved draft. Kept text would be stored Quran Foundation content,
 * which must be maintained through Content Sync to be kept past a week. What
 * a project keeps is only a caption's hand edit (`VerseData.displayTafsir`),
 * the user's own work, as a translation's correction is.
 *
 * Al-Muyassar explains some ayahs together (Al-Mulk 20-21, Ya-Sin 3-4), and
 * the chapter listing gives such a group once, under its first ayah, with no
 * entry for the rest. Each of the rest takes the group's text, so every
 * caption of the ayahs it explains shows it.
 */

import { quranApiJson } from './quranApi';
import { cleanHtml } from './quranCorpus';
import { SURAHS_LIST } from './quranData';

export const TAFSIR_ID = 16;

interface ApiTafsir {
  verse_key?: string;
  text?: string;
}

/** `{ "67:1": "…" }`: the tafsir of ayahs `start`..`end` of one surah, or null when the upstream could not answer. */
export async function fetchTafsirTexts(surah: number, start: number, end: number): Promise<Record<string, string> | null> {
  const { data } = await quranApiJson<{ tafsirs?: ApiTafsir[] }>(
    `/tafsirs/${TAFSIR_ID}/by_chapter/${surah}?per_page=300`,
    { next: { revalidate: 86400 } },
    body => (body.tafsirs || []).some(entry => entry?.text)
  );
  if (!data) return null;
  const byAyah = new Map<number, string>();
  for (const entry of data.tafsirs || []) {
    const ayah = Number(entry.verse_key?.split(':')[1]);
    const text = cleanHtml(entry.text || '');
    if (Number.isInteger(ayah) && text) byAyah.set(ayah, text);
  }
  return groupedTafsir(surah, start, end, byAyah);
}

/** `{ "67:21": … }` for ayahs `start`..`end`: an ayah with no entry of its own takes the nearest one before it, the group it is explained in. */
export function groupedTafsir(surah: number, start: number, end: number, byAyah: Map<number, string>): Record<string, string> {
  const last = Math.min(end, SURAHS_LIST.find(entry => entry.number === surah)?.numberOfAyahs ?? 0);
  const texts: Record<string, string> = {};
  let group = '';
  for (let ayah = 1; ayah <= last; ayah++) {
    group = byAyah.get(ayah) ?? group;
    if (ayah >= start && group) texts[`${surah}:${ayah}`] = group;
  }
  return texts;
}
