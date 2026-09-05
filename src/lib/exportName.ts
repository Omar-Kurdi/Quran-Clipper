/**
 * What the save dialog offers to call an exported clip.
 *
 * `At-Tahrim_66_6-8.mp4`: the surah, its number, and the ayah range. The name
 * used to say `QuranClip`, which told you nothing about which clip it was once
 * several had been rendered. The extension follows the container the export
 * actually produced -- the frame-by-frame path writes MP4, the real-time
 * recorder writes WebM -- because a name that lies about the format is worse
 * than one that is merely dull.
 *
 * The range is the one **on the timeline**, not the one that was matched or
 * selected. Trimming drops ayahs without rewriting those, so a clip cut down to
 * 66:6-8 was being filed under the 1-12 it was cut from. The caller is
 * responsible for passing the timeline's range -- see `clipPassage`.
 *
 * Characters that are illegal in filenames are stripped, including the colon:
 * it is legal on Linux and macOS but not on Windows, and a name that survives
 * everywhere is worth more than one that reads like a verse reference.
 *
 * There is deliberately no timestamp. Re-exporting the same passage should
 * produce the same name, and a browser disambiguates a collision by appending
 * its own counter.
 */
export function exportFileName(
  surahNameEnglish: string,
  surahNumber: number,
  ayahStart: number,
  ayahEnd: number,
  extension: 'webm' | 'mp4' = 'webm'
): string {
  const name = surahNameEnglish.trim().replace(/\s+/g, '_').replace(/[/\\?%*|"<>:]/g, '') || 'QuranClip';
  return `${name}_${surahNumber}_${ayahStart}-${ayahEnd}.${extension}`;
}
