/**
 * A built-in reciter's passage cut out of its recording, for a ground-truth
 * file -- from the passage recording this server already keeps
 * (`qfPassageFile`), so nothing is fetched.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { qfPassageFile, qfPassageOf } from './qfRecitations';
import { findFfmpeg } from './renderRunner';
import { groundTruthAudioName } from './groundTruth';

/** The reciter passage an address names; null for any other address. */
export const recordingOf = qfPassageOf;

/** Writes [start, end] of the recording at `address` to `output` as WAV; the reason it could not, or null. */
export async function cutRecording(address: string, start: number, end: number, output: string): Promise<string | null> {
  const passage = recordingOf(address);
  if (!passage) return 'not a reciter passage';
  if (!(end > start && start >= 0)) return 'no window to cut';
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return 'ffmpeg is not installed';
  const file = await qfPassageFile(passage.reciterId, passage.surah, passage.start, passage.end, ffmpeg).catch(() => null);
  if (!file) return 'the recitation could not be prepared';
  return run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3),
    '-i', file, '-vn', '-c:a', 'pcm_s16le', output]);
}

function run(ffmpeg: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    proc.once('error', err => resolve(err.message));
    proc.once('close', code => resolve(code === 0 ? null : stderr.trim() || 'ffmpeg failed'));
  });
}

/** Bigger than any clip worth aligning, and small enough to not be a way in. */
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * The audio beside the file: the upload as sent, or a built-in reciter's
 * passage cut here from its recording. Null when there is none.
 */
export async function writeGroundTruthAudio(form: FormData, dir: string, clipName: string): Promise<{ written: string } | { error: string; status: number } | null> {
  const audio = form.get('audio');
  const recording = String(form.get('audioUrl') || '');
  if (!(audio instanceof File && audio.size > 0) && !recording) return null;
  const audioName = groundTruthAudioName(clipName);
  const target = path.join(dir, 'audio', audioName);
  await mkdir(path.join(dir, 'audio'), { recursive: true });
  if (audio instanceof File && audio.size > 0) {
    if (audio.size > MAX_AUDIO_BYTES) return { error: 'audio too large', status: 413 };
    await writeFile(target, Buffer.from(await audio.arrayBuffer()));
  } else {
    const failed = await cutRecording(recording, Number(form.get('windowStart')), Number(form.get('windowEnd')), target);
    if (failed) return { error: failed, status: 502 };
  }
  return { written: path.join('audio', audioName) };
}
