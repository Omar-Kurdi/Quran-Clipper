import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import { afterEach, describe, it, expect, vi } from 'vitest';

type Upstream = PassThrough & { statusCode: number; headers: Record<string, string> };

/**
 * Each call to `https.request` is answered by the next of these, in order: a
 * response, or a connection that fails with `error`. With none left, a 404 --
 * the proxy's own background fetch for its cache asks once more after a 200
 * or 206, and is turned away.
 */
const upstreams: Array<{ status: number; headers: Record<string, string> } | { error: string }> = [];
const upstreamRequests: Array<{ url: string; headers?: Record<string, string> }> = [];
const responses: Upstream[] = [];

vi.mock('node:https', () => ({
  default: {
    // The proxy keeps connections open between requests; nothing to model here.
    Agent: class {},
    request(url: URL, opts: { headers?: Record<string, string> }, onResponse: (res: Upstream) => void) {
      upstreamRequests.push({ url: url.href, headers: opts.headers });
      const next = upstreams.shift() ?? { status: 404, headers: {} };
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => {
        if ('error' in next) {
          queueMicrotask(() => req.emit('error', Object.assign(new Error(next.error), { code: next.error })));
          return;
        }
        const res = Object.assign(new PassThrough(), { statusCode: next.status, headers: next.headers });
        responses.push(res);
        queueMicrotask(() => onResponse(res));
      };
      return req;
    }
  }
}));

// The proxy's disk cache, in a folder of this run's own.
process.env.QC_AUDIO_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), 'qc-proxy-test-'));

const { GET } = await import('./route');

const recording = 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/5.mp3';
const proxied = (range?: string) =>
  new NextRequest(`http://localhost:3000/api/audio/proxy?url=${encodeURIComponent(recording)}`, {
    headers: range ? { range } : undefined
  });

afterEach(() => {
  upstreams.length = 0;
  upstreamRequests.length = 0;
  responses.length = 0;
});

describe('audio proxy', () => {
  it('forwards Range and answers a partial request as a partial request', async () => {
    upstreams.push({ status: 206, headers: { 'content-range': 'bytes 0-99/38326543', 'content-length': '100' } });
    const res = await GET(proxied('bytes=0-99'));
    responses[0].end(Buffer.alloc(100));

    expect(upstreamRequests[0].headers).toEqual({ Range: 'bytes=0-99' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-99/38326543');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('stops pulling the recording when the reader goes away', async () => {
    // ffmpeg opens every file with an open-ended range and drops it after a few
    // kilobytes to seek; the upstream must go with it, not run to the end.
    upstreams.push({ status: 206, headers: { 'content-range': 'bytes 0-38326542/38326543' } });
    const res = await GET(proxied('bytes=0-'));
    const reader = res.body!.getReader();
    responses[0].write(Buffer.alloc(8192));
    await reader.read();
    await reader.cancel();

    expect(responses[0].destroyed).toBe(true);
  });

  it('follows a redirect to an allowed host but refuses one off the list', async () => {
    upstreams.push(
      { status: 302, headers: { location: 'https://audio.qurancdn.com/5.mp3' } },
      { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }
    );
    const res = await GET(proxied());

    expect(upstreamRequests.map(r => r.url)).toEqual([recording, 'https://audio.qurancdn.com/5.mp3']);
    expect(res.status).toBe(400);
  });

});

describe('audio proxy, when the CDN falters or the recording is held', () => {
  it('tries again when the CDN refuses the connection, and when one of its edges fails', async () => {
    // download.quranicaudio.com's edge refused connections and answered 5xx in
    // bursts (2026-10-08); one refusal used to fail the whole match.
    upstreams.push({ error: 'ECONNREFUSED' }, { status: 503, headers: {} }, { status: 206, headers: { 'content-range': 'bytes 0-9/100', 'content-length': '10' } });
    const res = await GET(proxied('bytes=0-9'));
    responses[responses.length - 1].end(Buffer.alloc(10));

    expect(res.status).toBe(206);
    expect(upstreamRequests.slice(0, 3).map(r => r.url)).toEqual([recording, recording, recording]);
  });

  it('serves a recording it already holds from disk, asking the CDN nothing', async () => {
    const cached = path.join(process.env.QC_AUDIO_CACHE_DIR!, `${createHash('sha256').update(recording).digest('hex')}.audio`);
    mkdirSync(path.dirname(cached), { recursive: true });
    writeFileSync(cached, Buffer.from(Array.from({ length: 100 }, (_, i) => i)));
    const res = await GET(proxied('bytes=10-19'));

    expect(upstreamRequests).toEqual([]);
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    // What the prefetch script waits for.
    expect(res.headers.get('x-audio-cache')).toBe('hit');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
});
