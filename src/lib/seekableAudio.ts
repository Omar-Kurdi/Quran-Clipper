/**
 * Whether an upload needs a copy to play from that seeks where it is asked to.
 *
 * Chrome seeks a variable-bitrate MP3 through the hundred points of its Xing
 * table, so the `<audio>` element lands wherever that estimate puts it: on a
 * reciter's surah file, measured against the decoded audio, a seek to 112.9 s
 * played from 113.84 s, and others were up to 1.4 s out, early or late. The
 * waveform, the aligner and the export all decode the file whole, so they
 * agree with each other and the element alone was off -- which reads as
 * captions that do not fit the audio. A WAV of the same decode seeks exactly.
 *
 * A constant-bitrate MP3 is seeked by arithmetic, which is exact, and its
 * LAME header says `Info` rather than `Xing`, so only `Xing` and Fraunhofer's
 * `VBRI` mark a file as one to copy. Pure, so it can be tested.
 */

/** Longer than this, the copy is not made: decoded whole it would hold too much of the browser's memory. */
export const SEEKABLE_COPY_MAX_SEC = 30 * 60;

/** Skips an ID3v2 tag at the start, whose size is synchsafe, plus its footer if it has one. */
function afterId3(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/**
 * True for an MP3 whose first frame carries a variable-bitrate header. `bytes`
 * is the start of the file: enough to hold its ID3 tag and first frame.
 */
export function isVbrMp3(bytes: Uint8Array): boolean {
  let at = afterId3(bytes);
  // The first frame sync after the tag; padding and junk before it are skipped.
  while (at + 4 < bytes.length && !(bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0)) at++;
  if (at + 4 >= bytes.length) return false;
  const mpeg1 = (bytes[at + 1] & 0x18) === 0x18;
  const mono = (bytes[at + 3] & 0xc0) === 0xc0;
  // The Xing header sits after the side information, whose length depends on both.
  const xing = at + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
  return ascii(bytes, xing, 'Xing') || ascii(bytes, at + 36, 'VBRI');
}

/** Whether a file is an MP3 by its type or, where the browser gives none, its name. */
export const looksLikeMp3 = (file: { name: string; type: string }) =>
  file.type === 'audio/mpeg' || file.type === 'audio/mp3' || (!file.type && /\.mp3$/i.test(file.name));
