import { useEffect, useState } from 'react';

/**
 * The brief tafsir of the ayahs on the timeline, while the style asks for it
 * (`showTafsir`). Held in memory only -- see `tafsirTexts.ts` -- so a project
 * or draft never keeps it (only a hand edit, `VerseData.displayTafsir`), and
 * asked for again when the studio is opened.
 */

type Texts = Record<string, string>;
const EMPTY: Texts = {};
/** One request per surah while the page is open. */
const bySurah = new Map<number, Promise<Texts>>();

function surahTafsir(surah: number): Promise<Texts> {
  let pending = bySurah.get(surah);
  if (!pending) {
    pending = fetch(`/api/quran/tafsir?surah=${surah}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.success) throw new Error('no tafsir');
        return data.verses as Texts;
      })
      .catch(() => {
        // Asked again on the next change rather than never.
        bySurah.delete(surah);
        return EMPTY;
      });
    bySurah.set(surah, pending);
  }
  return pending;
}

/** The tafsir by verse key, and whether what was asked for has come back (always, when it is off). */
export function useTafsir(verses: { verseKey: string }[], on: boolean): { texts: Texts; ready: boolean } {
  const surahs = on
    ? [...new Set(verses.map(verse => Number(verse.verseKey.split(':')[0])).filter(surah => surah >= 1 && surah <= 114))].sort((a, b) => a - b).join(',')
    : '';
  const [arrived, setArrived] = useState<{ surahs: string; texts: Texts }>({ surahs: '', texts: EMPTY });

  useEffect(() => {
    if (!surahs) return;
    let live = true;
    Promise.all(surahs.split(',').map(Number).map(surahTafsir)).then(all => {
      if (live) setArrived({ surahs, texts: Object.assign({}, ...all) });
    });
    return () => { live = false; };
  }, [surahs]);

  const ready = !surahs || arrived.surahs === surahs;
  return { texts: surahs && ready ? arrived.texts : EMPTY, ready };
}
