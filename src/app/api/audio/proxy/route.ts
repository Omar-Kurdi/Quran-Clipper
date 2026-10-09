import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { cachedAudio, fillAudioCache, servedFromCache } from '@/lib/audioCache';

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
  'verses.quran.com',
  // QUL's recordings, which its timings for Sudais, Ghamdi, Shuraim and
  // Dosari were measured on. See `lib/qulRecitations.ts`.
  'audio-cdn.tarteel.ai'
]);

/**
 * mp3quran.net, which hosts the reciters quran.com has no timings for.
 *
 * A suffix rather than a list: those recitations are spread across server6, 7,
 * 11 and 12, and which server holds whom is theirs to change. The sidecar's
 * `ALLOWED_AUDIO_HOSTS` has carried this entry from the start and its comment
 * asks for the two lists to be kept in step; this one had fallen behind, so a
 * reciter without measured timings was served straight from the CDN while
 * every timed one went through here. That is the difference between a
 * recording that survives a dead IPv6 route and one that does not --
 * `server11.mp3quran.net` publishes an AAAA record too.
 */
const ALLOWED_HOST_SUFFIX = '.mp3quran.net';

export function hostAllowed(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname) || hostname.endsWith(ALLOWED_HOST_SUFFIX);
}

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
  if (target.protocol !== 'https:' || !hostAllowed(target.hostname)) return null;
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
 * Connections kept open between requests. ffmpeg reads a recording in many
 * range requests -- one per seek -- and a new connection for each was what the
 * CDN started refusing (ECONNREFUSED from download.quranicaudio.com's edge,
 * 2026-10-08) when several were read at once.
 */
const KEEP_ALIVE = new https.Agent({ keepAlive: true, maxSockets: 16 });

/**
 * One upstream request, over `node:https` rather than `fetch`.
 *
 * Measured in this server against download.quranicaudio.com: `fetch` drained a
 * 38 MB recording in about 21 s, `node:https` in about 2 s, same process and
 * same file. The sidecar's ffmpeg reads a surah linearly up to the window it
 * wants, so that throughput was the whole cost of an aligner match on a
 * built-in reciter.
 *
 * `signal` is the caller's: when the browser or ffmpeg drops the connection,
 * the upstream request goes with it instead of pulling the rest of the file.
 */
function requestOnce(
  url: URL,
  method: 'GET' | 'HEAD',
  headers: Record<string, string> | undefined,
  signal: AbortSignal
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, signal, agent: KEEP_ALIVE }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/**
 * `requestOnce`, tried again after a moment when the connection itself fails.
 *
 * A dropped connection or a failed lookup used to answer 502 at once, and the
 * sidecar reading a reciter's recording through here then gave up on the
 * match: the load kept its published timings with no isti'adha and no pauses
 * heard, and nothing said so. Seen in bursts against download.quranicaudio.com
 * (2026-10-08), each gone a second later. An HTTP answer, even an error, is
 * the server's and is passed on as it is.
 */
async function requestWithRetry(
  url: URL,
  method: 'GET' | 'HEAD',
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  attempt = 1
): Promise<IncomingMessage> {
  const last = attempt >= CONNECT_ATTEMPTS;
  try {
    const res = await requestOnce(url, method, headers, signal);
    // A CDN edge failing for a moment (BunnyCDN answers 502/503 from one
    // edge while the next is fine) is no answer about the file.
    if ((res.statusCode ?? 0) < 500 || last) return res;
    res.resume();
  } catch (err) {
    if (signal.aborted || last) throw err;
  }
  await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  return requestWithRetry(url, method, headers, signal, attempt + 1);
}

/** Tries at connecting before the proxy gives up on the audio server. */
const CONNECT_ATTEMPTS = 4;

/**
 * Fetches `target`, following redirects **only** to hosts on the allowlist.
 *
 * Following redirects blindly quietly undoes the allowlist: an allowed host
 * answering `302 Location: http://169.254.169.254/` would be followed, and this
 * server would fetch it and stream the body back. The check has to be applied
 * to every hop, not just the one the caller named, which means doing the
 * following here (`node:https` never follows on its own).
 */
async function fetchAllowedOnly(
  target: URL,
  init: { method: 'GET' | 'HEAD'; headers?: Record<string, string>; signal: AbortSignal }
): Promise<IncomingMessage | null> {
  let url = target;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await requestWithRetry(url, init.method, init.headers, init.signal);
    const status = res.statusCode ?? 502;
    if (status < 300 || status >= 400) return res;

    // A redirect's own body is never used; drain it so its socket is freed.
    res.resume();
    const location = res.headers.location;
    if (!location) return res;
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return null;
    }
    if (next.protocol !== 'https:' || !hostAllowed(next.hostname)) return null;
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

  // Fetched once already: from this server's disk -- see `audioCache`.
  const cached = method === 'GET' ? cachedAudio(target.href) : null;
  if (cached) {
    const served = servedFromCache(cached, range, 'audio/mpeg');
    return new NextResponse(served.body, { status: served.status, headers: served.headers });
  }
  const upstream = await fetchAllowedOnly(target, {
    method,
    headers: range ? { Range: range } : undefined,
    signal: req.signal
  });
  if (!upstream) {
    return NextResponse.json({ error: 'Unsupported audio source.' }, { status: 400 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const value = upstream.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400');

  // Kept for next time, fetched whole in the background; this answer streams as before.
  const status = upstream.statusCode ?? 502;
  if (method === 'GET' && (status === 200 || status === 206)) {
    fillAudioCache(target.href, () => fetchAllowedOnly(target, { method: 'GET', signal: AbortSignal.timeout(10 * 60_000) }));
  }

  // Cancelling the web stream destroys `upstream`, which ends the request.
  let body: ReadableStream<Uint8Array> | null = null;
  if (method === 'HEAD') upstream.resume();
  else body = Readable.toWeb(upstream) as ReadableStream<Uint8Array>;

  return new NextResponse(body, {
    status: upstream.statusCode ?? 502,
    headers
  });
}

export async function GET(req: NextRequest) {
  try {
    return await forward(req, 'GET');
  } catch (err) {
    const { code, message } = err as NodeJS.ErrnoException;
    console.warn(`[audio proxy] could not reach the audio server: ${code ?? ''} ${message}`);
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
