/**
 * The stretch of audio an export should cover.
 *
 * For an upload, the whole file. The file already *is* the clip: the trimmer
 * cut it to the window the user chose, and the preview plays it from 0:00 to
 * its end. Cutting it again at the captions exported something neither of
 * those showed -- the first caption sits wherever the aligner put the first
 * word, 0.3-0.7s in on the Ash-Shura clips here, so the reciter's first breath
 * and the onset of the first word were missing from the video.
 *
 * For a built-in reciter, the first ayah's start to the last one's end. That
 * audio is the entire chapter, so exporting the file turned a three-ayah clip
 * from Al-Baqarah into an eighty-seven minute video -- and because capture
 * runs in real time, an eighty-seven minute wait for it.
 */
export function exportRangeFor(
  verses: { startTime: number; endTime: number }[],
  audioDuration: number,
  isUpload: boolean
): { start: number; end: number; span: number } {
  const whole = { start: 0, end: audioDuration, span: audioDuration };
  if (isUpload || verses.length === 0 || !(audioDuration > 0)) return whole;
  const start = Math.max(0, Math.min(...verses.map(v => v.startTime)));
  const end = Math.min(audioDuration, Math.max(...verses.map(v => v.endTime)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return whole;
  return { start, end, span: end - start };
}
