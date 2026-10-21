import { getRange } from './quranCorpus';
import { qfPassage, qfPassageOf, qfReciter } from './qfRecitations';

/**
 * How many ayahs before the passage the aligner is given, as heard before the
 * recording starts, so a reciter going back over them is heard repeating:
 * Al-Ajmy goes back from 74:30 to 74:21, before a passage that starts at 74:24.
 */
const REPEAT_LOOKBACK = 10;

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
    // A chapter reciter's surah whose Foundation timings were not this recording's has the aligner's words instead.
    provider: recording.words === 'cut' ? 'cut' : 'qf',
    sung: qfReciter(file.reciterId)?.style === 'Mujawwad',
    passage: passage.map(verse => ({ verseKey: verse.verseKey, wordCount: verse.words.length, words: verse.words.map(word => word.arabic) })),
    timings,
    // The recording holds the file's ayahs and no others, so those are the ones to align it against -- with the
    // few before them, so a reciter going back over them is heard repeating, not read as the passage's own ayahs.
    aligned: { start: Math.max(1, file.start - REPEAT_LOOKBACK), end: file.end, heardBefore: file.start - Math.max(1, file.start - REPEAT_LOOKBACK) },
  };
}
