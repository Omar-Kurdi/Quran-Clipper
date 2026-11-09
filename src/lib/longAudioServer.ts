/**
 * The server's half of trimming a long recording (`longAudio.ts`): reading it
 * once into a peak envelope, and cutting the stretch chosen. Both read the
 * recording from its start, so both are on the one clock ffmpeg decodes --
 * the clock the waveform was drawn on is the clock the cut is made on.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ENVELOPE_SAMPLE_RATE, EnvelopeMeter } from './longAudio';

const listenDir = () => path.join(os.tmpdir(), 'quran-clipper-listen');
/** A kept recording's id (`editSources`), which names its copy to listen to. */
export const LISTEN_ID = /^[0-9a-f]{64}$/;
/** A day: long enough for a trim, and the copy is made again by the next read. */
const LISTEN_KEEP_MS = 24 * 60 * 60 * 1000;

/** Where the copy to listen to of the recording kept as `id` is written. */
export const listenFile = (id: string) => path.join(listenDir(), `${id}.ogg`);

/** Makes room for a new copy to listen to: copies from earlier trims go after a day. */
export async function forgetOldListens() {
  await mkdir(listenDir(), { recursive: true });
  const names = await readdir(listenDir()).catch(() => [] as string[]);
  const now = Date.now();
  await Promise.all(names.map(async name => {
    const file = path.join(listenDir(), name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > LISTEN_KEEP_MS) await rm(file, { force: true });
  }));
}

/**
 * The recording's peak envelope and its length, read without holding it
 * whole, and in the same pass a copy to listen to (`listen`).
 *
 * The dialog cannot play the upload itself: the browser's player seeks an MP3
 * by estimate, and on the Al-Baqarah recording this was built for it played
 * 1.9 s away from where ffmpeg -- and so the cut -- puts the same moment, an
 * hour and forty minutes in. Seeking in an Ogg Opus copy agreed with ffmpeg to
 * within the 25 ms that test could resolve. Small, too: 59 MB for two hours.
 */
export function readEnvelope(ffmpeg: string, file: string, listen: string): Promise<{ envelope: Uint8Array; duration: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
      '-map', '0:a:0', '-ac', '1', '-ar', String(ENVELOPE_SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
      '-map', '0:a:0', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', listen,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const meter = new EnvelopeMeter();
    // A chunk can end inside a sample; its bytes wait for the next one.
    let carry = Buffer.alloc(0);
    proc.stdout.on('data', (chunk: Buffer) => {
      const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = bytes.length - (bytes.length % 4);
      const aligned = Buffer.from(bytes.subarray(0, whole));
      meter.push(new Float32Array(aligned.buffer, aligned.byteOffset, whole / 4));
      carry = Buffer.from(bytes.subarray(whole));
    });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    proc.once('error', reject);
    proc.once('close', code => {
      const read = meter.finish();
      if (code === 0 && read.duration > 0) resolve(read);
      else reject(new Error(stderr.trim() || 'ffmpeg could not read the recording'));
    });
  });
}

/**
 * [start, end] of the recording as an MP3, written to `output`.
 *
 * Seeking after the input rather than before it: ffmpeg then reads from the
 * start and counts samples, which is exact, where a seek in a VBR MP3 is an
 * estimate. It is also fast -- an hour and forty minutes in of a two-hour
 * recording took three seconds. MP3, not WAV: forty minutes of WAV is 460 MB,
 * past what a match will take.
 */
export function cutLongAudio(ffmpeg: string, file: string, start: number, end: number, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
      '-ss', start.toFixed(3), '-to', end.toFixed(3), '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    proc.once('error', reject);
    proc.once('close', code => (code === 0 ? resolve() : reject(new Error(stderr.trim() || 'ffmpeg could not cut the recording'))));
  });
}
