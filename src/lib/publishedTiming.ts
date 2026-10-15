import { getRange } from './quranCorpus';
import { qfPassage, qfPassageOf, qfReciter } from './qfRecitations';

/**
 * A passage's published timings, when `audioUrl` is a built-in reciter's
 * passage recording (`qfPassageUrl`, from any origin) holding these ayahs.
 * Null for any other audio, which is then aligned as before.
 *
 * The bounds are the ayah files' own -- each ayah starts where its file does
 * in the passage recording -- and the word timings are the Quran Foundation's
 * within each file, on the same clock. The aligner is then only asked where
 * the reciter paused inside an ayah: see `publishedPhrases`.
 */
export async function publishedPassage(audioUrl: string, surah: number, { start, end }: { start: number; end: number }) {
  const file = qfPassageOf(audioUrl);
  if (!file || file.surah !== surah || start < file.start || end > file.end) return null;
  const [passage, recording] = await Promise.all([
    getRange(surah, start, end),
    qfPassage(file.reciterId, surah, file.start, file.end).catch(() => null),
  ]);
  if (!passage.length || !recording) return null;
  const timings = new Map(recording.ayahs.map(ayah => [ayah.verseKey, ayah.timing]));
  if (!passage.every(verse => timings.has(verse.verseKey))) return null;
  return {
    provider: 'qf',
    sung: qfReciter(file.reciterId)?.style === 'Mujawwad',
    passage: passage.map(verse => ({ verseKey: verse.verseKey, wordCount: verse.words.length, words: verse.words.map(word => word.arabic) })),
    timings,
    // The recording holds the file's ayahs and no others, so those are the ones to align it against.
    aligned: { start: file.start, end: file.end },
  };
}
