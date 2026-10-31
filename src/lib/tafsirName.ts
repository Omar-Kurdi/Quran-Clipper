/** The tafsir the captions can show (`tafsirTexts.ts`), as the clip's description credits it. Its own module, so the studio can name it without the server fetch. */
export const TAFSIR_NAME = 'Al-Tafsir al-Muyassar (King Fahd Complex)';

/** The heading the card draws over the tafsir, so it is not read as a second translation. */
export const TAFSIR_LABEL = 'التفسير الميسر';

/**
 * The ayahs on the timeline whose tafsir is `verseKey`'s: the run of ayahs
 * either side that the fetched text explains together (`groupedTafsir`), so an
 * edit to one is an edit to the group. Just `verseKey` when it stands alone.
 */
export function sharedTafsirKeys(texts: Record<string, string>, verseKey: string): string[] {
  const text = texts[verseKey];
  const [surah, ayah] = verseKey.split(':').map(Number);
  if (!text || !Number.isInteger(surah) || !Number.isInteger(ayah)) return [verseKey];
  let from = ayah;
  let to = ayah;
  while (texts[`${surah}:${from - 1}`] === text) from--;
  while (texts[`${surah}:${to + 1}`] === text) to++;
  return Array.from({ length: to - from + 1 }, (_, i) => `${surah}:${from + i}`);
}

/**
 * The tafsir a caption of `verseKey` shows: the hand edit any caption of that
 * ayah carries (`VerseData.displayTafsir`), else the fetched text. Read across
 * the timeline rather than off one caption, so a caption added to the ayah
 * after the edit shows it too.
 */
export function shownTafsir(
  verses: { verseKey: string; displayTafsir?: string }[],
  texts: Record<string, string>,
  verseKey: string
): string | undefined {
  return verses.find(verse => verse.verseKey === verseKey && verse.displayTafsir !== undefined)?.displayTafsir ?? texts[verseKey];
}
