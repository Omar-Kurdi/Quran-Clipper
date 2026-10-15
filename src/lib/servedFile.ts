/**
 * A file on this server's disk as an HTTP response, honouring Range: the
 * browser's player and the sidecar's ffmpeg both seek in a recording by asking
 * for byte ranges of it.
 */

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

/** The bytes a Range header asks for, within a file of `size`; null for the whole file, or 'unsatisfiable'. */
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/** `file` as a response body and its headers, honouring Range. */
export function servedFile(
  file: { file: string; size: number }, rangeHeader: string | null, contentType: string
): { status: number; headers: Headers; body: ReadableStream<Uint8Array> | null } {
  const headers = new Headers({ 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400' });
  const range = byteRange(rangeHeader, file.size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${file.size}`);
    return { status: 416, headers, body: null };
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  headers.set('content-length', String(end - start + 1));
  if (range) headers.set('content-range', `bytes ${start}-${end}/${file.size}`);
  const body = Readable.toWeb(createReadStream(file.file, { start, end })) as ReadableStream<Uint8Array>;
  return { status: range ? 206 : 200, headers, body };
}
