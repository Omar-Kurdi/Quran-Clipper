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
  /** The audio the evaluator should decode, e.g. `test5.mp3`. */
  clipName?: string;
  /** Length of the audio the timeline describes, in seconds. */
  duration?: number;
  /**
   * The window of `clipName` this timeline covers, when the file still needs
   * cutting.
   *
   * Null whenever the named audio is already the audio the captions describe --
   * which is the case whenever the studio saved a copy alongside this file,
   * because the copy it saves is the trimmed one. Cutting it again would score
   * a timeline against a window inside a window.
   */
  trim?: { start: number; end: number } | null;
  /**
   * Where that audio was cut from, for a person reading the file later.
   *
   * Provenance only -- nothing reads it back. It exists because "which part of
   * which recording is this?" is otherwise unanswerable once the trimmed copy
   * is the only file left.
   */
  from?: { name: string; start: number; end: number } | null;
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
    ...(meta.from
      ? [`# from: ${meta.from.name} ${meta.from.start.toFixed(2)}-${meta.from.end.toFixed(2)}`]
      : []),
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

/**
 * The stem both files share, from the clip's name.
 *
 * Everything outside `[A-Za-z0-9_-]` goes: a clip called
 * `Surah Hashr ... 😭😭 #surahhashr [4LXnIpuIYgA]-trimmed.wav` is a perfectly
 * ordinary file name and a menace as an argument -- to ffmpeg, to a shell loop
 * over `scripts/expected_*.txt`, and to anyone typing it. It is also the
 * traversal vector when it names a file the server writes, so the same
 * stripping is what makes it safe to join to a path.
 */
export function groundTruthBaseName(clipName?: string): string {
  const name = clipName || 'timeline';
  const base = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'timeline';

  // A name written entirely in another script survives the strip as nothing:
  // `{التائبون العابدون...} تلاوة عراقية مؤثرة ياسر الدوسري.mp3` becomes `_`, and
  // after two trims `_-trimmed-trimmed`. Two such clips trimmed the same number
  // of times land on the same file name, and saving the second overwrites the
  // first -- silently, and the corrected timeline it destroys is hand work that
  // exists nowhere else.
  //
  // So when nothing distinguishing survives -- everything left is the `-trimmed`
  // suffixes the studio added and the separators -- the original name is carried
  // through as a short digest of itself. Names that keep any identity of their
  // own are untouched.
  const distinguishing = base.replace(/(-trimmed)+$/, '').replace(/[_-]+/g, '');
  return distinguishing ? base : `${base}-${shortDigest(name)}`;
}

/**
 * A few stable characters standing in for a name, for telling two apart.
 *
 * FNV-1a, because this only has to differ for different names -- it is not
 * guarding anything -- and it has to give the same answer in the browser and in
 * Node without pulling in a hash implementation for six lines of work.
 */
function shortDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

/** `expected_test5.txt` -- what `eval_segments.py` should be pointed at. */
export function groundTruthFileName(clipName?: string): string {
  return `expected_${groundTruthBaseName(clipName)}.txt`;
}

/**
 * Audio containers the studio will write beside a ground-truth file.
 *
 * A whitelist rather than "whatever extension the upload had", because this
 * decides a file name on disk.
 */
export const GROUND_TRUTH_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.opus', '.webm', '.flac'];

/** `Aal-E-Imran-trimmed.wav` -- the copy saved next to the expected file. */
export function groundTruthAudioName(clipName?: string): string {
  const match = (clipName || '').toLowerCase().match(/\.[a-z0-9]+$/);
  const extension = match && GROUND_TRUTH_AUDIO_EXTENSIONS.includes(match[0]) ? match[0] : '.wav';
  return `${groundTruthBaseName(clipName)}${extension}`;
}
