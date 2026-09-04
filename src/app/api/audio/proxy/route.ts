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
 * would make the studio an open relay for whoever can reach it. The allowlist
 * is applied to every redirect hop as well as to the URL the caller supplies --
 * see `fetchAllowedOnly`.
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

/**
 * How many redirects to follow before giving up.
 *
 * CDNs redirect legitimately -- a download host handing off to an edge node --
 * so refusing outright would break real audio. Three hops is more than any of
 * the allowed hosts uses and bounds a redirect loop.
 */
const MAX_HOPS = 3;

/**
 * Fetches `target`, following redirects **only** to hosts on the allowlist.
 *
 * `fetch` follows redirects itself by default, and that quietly undoes the
 * allowlist: an allowed host answering `302 Location: http://169.254.169.254/`
 * would be followed, and this server would fetch it and stream the body back.
 * The check has to be applied to every hop, not just the one the caller named,
 * which means doing the following here rather than letting fetch do it.
 */
async function fetchAllowedOnly(
  target: URL,
  init: { method: 'GET' | 'HEAD'; headers?: Record<string, string> }
): Promise<Response | null> {
  let url = target;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetch(url, { ...init, cache: 'no-store', redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return null;
    }
    if (next.protocol !== 'https:' || !ALLOWED_HOSTS.has(next.hostname)) return null;
    url = next;
  }
  return null;
}

async function forward(req: NextRequest, method: 'GET' | 'HEAD') {
  const target = resolveTarget(req);
  if (!target) {
    return NextResponse.json({ error: 'Unsupported audio source.' }, { status: 400 });
  }

  // Range is forwarded verbatim: seeking in the player and the export pipeline
  // both depend on partial requests being answered as partial requests.
  const range = req.headers.get('range');
  const upstream = await fetchAllowedOnly(target, {
    method,
    headers: range ? { Range: range } : undefined
  });
  if (!upstream) {
    return NextResponse.json({ error: 'Unsupported audio source.' }, { status: 400 });
  }

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
