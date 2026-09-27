import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import { afterEach, describe, it, expect, vi } from 'vitest';

type Upstream = PassThrough & { statusCode: number; headers: Record<string, string> };

/** Each call to `https.request` is answered by the next of these, in order. */
const upstreams: Array<{ status: number; headers: Record<string, string> }> = [];
const requested: Array<{ url: string; headers?: Record<string, string> }> = [];
const responses: Upstream[] = [];

vi.mock('node:https', () => ({
  default: {
    request(url: URL, opts: { headers?: Record<string, string> }, onResponse: (res: Upstream) => void) {
      requested.push({ url: url.href, headers: opts.headers });
      const next = upstreams.shift();
      if (!next) throw new Error(`unexpected upstream request to ${url.href}`);
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => {
        const res = Object.assign(new PassThrough(), { statusCode: next.status, headers: next.headers });
        responses.push(res);
        queueMicrotask(() => onResponse(res));
      };
      return req;
    }
  }
}));

const { GET } = await import('./route');

const recording = 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/5.mp3';
const proxied = (range?: string) =>
  new NextRequest(`http://localhost:3000/api/audio/proxy?url=${encodeURIComponent(recording)}`, {
    headers: range ? { range } : undefined
  });

afterEach(() => {
  upstreams.length = 0;
  requested.length = 0;
  responses.length = 0;
});

describe('audio proxy', () => {
  it('forwards Range and answers a partial request as a partial request', async () => {
    upstreams.push({ status: 206, headers: { 'content-range': 'bytes 0-99/38326543', 'content-length': '100' } });
    const res = await GET(proxied('bytes=0-99'));
    responses[0].end(Buffer.alloc(100));

    expect(requested[0].headers).toEqual({ Range: 'bytes=0-99' });
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

    expect(requested.map(r => r.url)).toEqual([recording, 'https://audio.qurancdn.com/5.mp3']);
    expect(res.status).toBe(400);
  });
});
