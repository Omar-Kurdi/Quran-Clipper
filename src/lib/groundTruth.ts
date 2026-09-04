/**
 * Turns a corrected timeline into a ground-truth file the evaluator can score
 * against.
 *
 * Segmentation quality has been measured against exactly one clip, and that has
 * repeatedly made "is this change better?" unanswerable -- twice a change that
 * scored higher on that clip was the wrong change, and the argument had to be
 * settled by ear instead of by number. The person using the studio is already
 * correcting captions by listening; this is the missing step that turns those
 * corrections into a test the next change has to pass.
 *
 * The format is `scripts/expected_segments.txt`: comments, then one segment per
 * line in recitation order. `eval_segments.py` resolves each line back to a word
 * range by skeleton match, so the orthography does not have to be exact.
 */

import { VerseData, SURAHS_LIST } from '@/lib/quranData';

/** What a caption actually showed: the recited words, not the whole ayah. */
function recitedText(verse: VerseData): string {
  const words = verse.words?.filter(word => !word.excluded).map(word => word.arabic);
  if (words?.length) return words.join(' ');
  return (verse.displayTextUthmani || verse.textUthmani || '').trim();
}

export interface GroundTruthMeta {
  /** The audio this timeline belongs to, e.g. `test5.mp3`. */
  clipName?: string;
  /** Length of the audio the timeline describes, in seconds. */
  duration?: number;
  /**
   * The window of the *original* file this timeline covers, when it was
   * trimmed in the studio.
   *
   * This is the field that makes the file reproducible. Trimming here is
   * destructive: the trimmed audio exists only in the browser, while the file
   * on disk is still the whole recording. Without the window, an evaluator
   * pointed at that file scores a timeline against audio it does not describe
   * and reports failures that are not real. With it, the same cut can be made
   * again with ffmpeg before scoring.
   */
  trim?: { start: number; end: number } | null;
}

/**
 * The file's contents. Returns an empty string for an empty timeline rather
 * than a header with nothing under it, so a caller can tell there is nothing
 * worth saving.
 */
export function groundTruthFile(verses: VerseData[], meta: GroundTruthMeta = {}): string {
  const lines = verses.map(recitedText).filter(Boolean);
  if (lines.length === 0) return '';

  const keys = verses.map(verse => verse.verseKey).filter(Boolean);
  const surahNumbers = Array.from(new Set(keys.map(key => parseInt(key.split(':')[0], 10))));
  const ayahs = keys.map(key => parseInt(key.split(':')[1], 10)).filter(Number.isFinite);
  const surahMeta = SURAHS_LIST.find(surah => surah.number === surahNumbers[0]);

  const passage = surahNumbers.length === 1 && ayahs.length
    ? `${surahMeta ? surahMeta.nameEnglish + ' ' : ''}${surahNumbers[0]}:${Math.min(...ayahs)}-${Math.max(...ayahs)}`
    : `${surahNumbers.length} surahs`;

  // Overlap is not a mistake and the file has to say so, or whoever reads it
  // next will "fix" it: a reciter who stops mid-phrase goes back a word or two
  // before carrying on, so two consecutive segments legitimately share words.
  const overlaps = verses.some((verse, i) => {
    const next = verses[i + 1];
    return !!next && next.verseKey === verse.verseKey && recitedText(next).startsWith(recitedText(verse).split(' ').slice(-1)[0]);
  });

  const surahNumber = surahNumbers.length === 1 ? surahNumbers[0] : null;
  // Machine-readable, so the evaluator can be run with no arguments and cannot
  // be pointed at the wrong audio or the wrong passage by mistake. Every value
  // here is one the person exporting this file would otherwise have to
  // remember and retype correctly.
  const facts = [
    `# clip: ${meta.clipName || 'unknown'}`,
    surahNumber && ayahs.length
      ? `# passage: ${surahNumber}:${Math.min(...ayahs)}-${Math.max(...ayahs)}`
      : '# passage: unknown',
    typeof meta.duration === 'number' && meta.duration > 0
      ? `# audio-seconds: ${meta.duration.toFixed(2)}`
      : '# audio-seconds: unknown',
    meta.trim
      ? `# trim: ${meta.trim.start.toFixed(2)}-${meta.trim.end.toFixed(2)}`
      : '# trim: none',
  ];

  return [
    `# Ground truth for ${meta.clipName || 'this recitation'} (${passage}), captured from the studio timeline.`,
    '# One expected segment per line, in recitation order. Blank lines and #-comments ignored.',
    '#',
    '# Text is matched to corpus word ranges by skeleton, so the orthography does not have',
    '# to be exact.',
    '#',
    '# The lines below are read by scripts/eval_segments.py -- keep them.',
    ...facts,
    ...(overlaps
      ? [
          '#',
          '# NOTE: consecutive segments overlap in word range in places. That is the reciter',
          '# restarting an earlier phrase and carrying further, which the pipeline has to',
          '# reproduce -- it is not a mistake in this file.',
        ]
      : []),
    '',
    ...lines,
    '',
  ].join('\n');
}

/** `expected_test5.txt` -- what `eval_segments.py` should be pointed at. */
export function groundTruthFileName(clipName?: string): string {
  const base = (clipName || 'timeline').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  return `expected_${base || 'timeline'}.txt`;
}
