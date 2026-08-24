import { NextRequest, NextResponse } from 'next/server';

/**
 * Streams a reciter recording from quran.com's audio CDN through this server.
 *
 * Not about CORS -- that CDN sends `access-control-allow-origin: *`. It is
 * about reachability: `download.quranicaudio.com` publishes an AAAA record, and
 * on a machine whose IPv6 route is dead the browser gets nothing while the
 * Node server (which falls back to IPv4) fetches it fine. Going through here
 * also makes the audio same-origin, so the Web Audio analyser and the waveform
 * fetch need no crossOrigin negotiation of their own.
 *
 * Only the hosts this app generates URLs for are allowed through; anything else
 * would make the studio an open relay for whoever can reach it.
 */
const ALLOWED_HOSTS = new Set([
  'download.quranicaudio.com',
  'audio.qurancdn.com',
  'verses.quran.com'
]);

/** Same shape used by the client, so callers do not hand-build the query. */
export function proxiedAudioUrl(upstream: string) {
  return `/api/audio/proxy?url=${encodeURIComponent(upstream)}`;
}

function resolveTarget(req: NextRequest): URL | null {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return null;
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) return null;
  return target;
}

async function forward(req: NextRequest, method: 'GET' | 'HEAD') {
  const target = resolveTarget(req);
  if (!target) {
    return NextResponse.json({ error: 'Unsupported audio source.' }, { status: 400 });
  }

  // Range is forwarded verbatim: seeking in the player and the export pipeline
  // both depend on partial requests being answered as partial requests.
  const range = req.headers.get('range');
  const upstream = await fetch(target, {
    method,
    headers: range ? { Range: range } : undefined,
    cache: 'no-store'
  });

  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400');

  return new NextResponse(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers
  });
}

export async function GET(req: NextRequest) {
  try {
    return await forward(req, 'GET');
  } catch {
    return NextResponse.json({ error: 'Could not reach the audio server.' }, { status: 502 });
  }
}

export async function HEAD(req: NextRequest) {
  try {
    return await forward(req, 'HEAD');
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
