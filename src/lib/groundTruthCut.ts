/**
 * A built-in reciter's passage cut out of their chapter recording, for a
 * ground-truth file -- on the server, because the chapter is the whole surah
 * (Al-Baqarah is about two hours), and decoding it in the tab to keep a minute
 * of it would run the tab out of memory.
 *
 * Fetched here rather than handed to ffmpeg as a URL: ffmpeg connects to one
 * address and stops, and on a machine with no IPv6 route it could not reach a
 * CDN that also publishes an IPv6 one (download.quranicaudio.com).
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hostAllowed } from '@/app/api/audio/proxy/route';
import { findFfmpeg } from './renderRunner';
import { groundTruthAudioName } from './groundTruth';

/** More than any chapter recording; a file past this is not one. */
const MAX_RECORDING_BYTES = 300 * 1024 * 1024;

/** The recording an address names, unwrapped from the studio's own proxy; null for a host not on the list. */
export function recordingUrl(address: string): URL | null {
  try {
    let url = new URL(address, 'http://studio.invalid');
    if (url.pathname === '/api/audio/proxy') url = new URL(url.searchParams.get('url') || '');
    return url.protocol === 'https:' && hostAllowed(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Writes [start, end] of the recording at `address` to `output` as WAV; the reason it could not, or null. */
export async function cutRecording(address: string, start: number, end: number, output: string): Promise<string | null> {
  const url = recordingUrl(address);
  if (!url) return 'not an allowed recording';
  if (!(end > start && start >= 0)) return 'no window to cut';
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return 'ffmpeg is not installed';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qc-gt-'));
  try {
    const copy = path.join(dir, 'recording');
    const res = await fetch(url);
    if (!res.ok || !res.body) return `the recording answered ${res.status}`;
    if (Number(res.headers.get('content-length')) > MAX_RECORDING_BYTES) return 'the recording is too large';
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(copy));
    return await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3),
      '-i', copy, '-vn', '-c:a', 'pcm_s16le', output]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
 * passage cut here from their chapter recording. Null when there is none.
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
