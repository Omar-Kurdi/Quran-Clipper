/**
 * One stretch of an uploaded recording, for the aligner to match on its own:
 * a clip of a long surah file is matched as that clip, not as the surah.
 *
 * Cut by ffmpeg reading from the start (`cutLongAudio`), which is exact even
 * in a VBR MP3, to the mono 16 kHz WAV the aligner reads. The times it
 * answers are on the stretch's clock and are put back on the recording's by
 * the caller (`shiftTimeline`).
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keptSourceFile } from './editSources';
import { cutLongAudio } from './longAudioServer';

/** The longest stretch matched at once: what the aligner takes in one pass (`MAX_LONG_TRIM_SEC`). */
export const MAX_UPLOAD_WINDOW_SEC = 40 * 60;

const scratch = (suffix: string) =>
  path.join(os.tmpdir(), `qc-window-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${suffix}`);

/**
 * [start, end] of the upload sent with the request, or of the one this
 * server keeps as `sourceId`; null when that one is no longer kept.
 */
export async function cutUploadWindow(
  ffmpeg: string, source: { file: File } | { sourceId: string }, start: number, end: number
): Promise<File | null> {
  const sent = 'file' in source ? scratch(path.extname(source.file.name).slice(0, 8)) : null;
  const input = sent ?? keptSourceFile((source as { sourceId: string }).sourceId);
  if (!input) return null;
  const output = scratch('.wav');
  try {
    if (sent) await writeFile(sent, Buffer.from(await (source as { file: File }).file.arrayBuffer()));
    await cutLongAudio(ffmpeg, input, { start, end }, output, 'aligner');
    return new File([new Uint8Array(await readFile(output))], 'window.wav', { type: 'audio/wav' });
  } finally {
    await Promise.all([output, sent].filter((file): file is string => !!file).map(file => rm(file, { force: true })));
  }
}
