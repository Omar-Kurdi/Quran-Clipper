/**
 * Reciter recordings kept on this server's disk once fetched, for the audio
 * proxy to serve from.
 *
 * Every load of a built-in reciter reads the chapter twice -- the browser
 * plays it, the sidecar's ffmpeg reads the passage -- and ffmpeg asks for it in
 * many range requests, one per seek. Each went to the CDN, and when several
 * loads ran together the CDN's edge started refusing connections
 * (ECONNREFUSED from download.quranicaudio.com, 2026-10-08). A refused read
 * failed the match, and a built-in reciter then lost its isti'adha and its
 * pauses without a word. Kept here, the recording is fetched once.
 *
 * A cache, nothing more: under the system's temporary directory, oldest
 * evicted past `MAX_CACHE_BYTES`, and any failure simply means the CDN is
 * asked as before.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Where recordings are kept; `QC_AUDIO_CACHE_DIR` moves it (tests give each run its own). */
const cacheDir = () => process.env.QC_AUDIO_CACHE_DIR || path.join(os.tmpdir(), 'quranclipper-audio');
/** Room for a dozen of the longest chapters. */
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
/** No chapter recording is near this; anything larger is not cached. */
const MAX_FILE_BYTES = 300 * 1024 * 1024;

const inFlight = new Set<string>();

const fileFor = (url: string) => path.join(cacheDir(), `${createHash('sha256').update(url).digest('hex')}.audio`);

/** The cached copy of a recording, if there is a whole one. */
export function cachedAudio(url: string): { file: string; size: number } | null {
  const file = fileFor(url);
  if (!existsSync(file)) return null;
  try {
    const { size } = statSync(file);
    // Touched so the oldest-read is what goes first.
    void utimes(file, new Date(), new Date()).catch(() => undefined);
    return { file, size };
  } catch {
    return null;
  }
}

/**
 * Fetches the whole recording into the cache, once at a time per address, in
 * the background. `fetchWhole` is the proxy's own allowlisted request.
 */
export function fillAudioCache(url: string, fetchWhole: () => Promise<IncomingMessage | null>): void {
  if (inFlight.has(url) || existsSync(fileFor(url))) return;
  inFlight.add(url);
  void (async () => {
    const target = fileFor(url);
    const partial = `${target}.${process.pid}.part`;
    try {
      const res = await fetchWhole();
      if (!res || res.statusCode !== 200 || Number(res.headers['content-length']) > MAX_FILE_BYTES) {
        res?.resume();
        return;
      }
      await mkdir(cacheDir(), { recursive: true });
      await pipeline(res, createWriteStream(partial));
      await rename(partial, target);
      await prune();
    } catch (err) {
      await rm(partial, { force: true });
      console.warn('[audio cache] could not keep a recording:', (err as Error).message);
    } finally {
      inFlight.delete(url);
    }
  })();
}

/** Drops the least recently read recordings until the cache fits. */
async function prune(): Promise<void> {
  const files = await Promise.all(
    (await readdir(cacheDir())).filter(name => name.endsWith('.audio')).map(async name => {
      const file = path.join(cacheDir(), name);
      const { size, mtimeMs } = await stat(file);
      return { file, size, mtimeMs };
    })
  );
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const evicted = files.sort((a, b) => a.mtimeMs - b.mtimeMs).filter(file => {
    if (total <= MAX_CACHE_BYTES) return false;
    total -= file.size;
    return true;
  });
  await Promise.all(evicted.map(file => rm(file.file, { force: true })));
}

/** The bytes a Range header asks for, within a file of `size`; null for the whole file, or 'unsatisfiable'. */
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/** A cached recording as a response body and its headers, honouring Range. */
export function servedFromCache(
  cached: { file: string; size: number }, rangeHeader: string | null, contentType: string
): { status: number; headers: Headers; body: ReadableStream<Uint8Array> | null } {
  const headers = new Headers({ 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400' });
  const range = byteRange(rangeHeader, cached.size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${cached.size}`);
    return { status: 416, headers, body: null };
  }
  const { start, end } = range ?? { start: 0, end: cached.size - 1 };
  headers.set('content-length', String(end - start + 1));
  if (range) headers.set('content-range', `bytes ${start}-${end}/${cached.size}`);
  const body = Readable.toWeb(createReadStream(cached.file, { start, end })) as ReadableStream<Uint8Array>;
  return { status: range ? 206 : 200, headers, body };
}
