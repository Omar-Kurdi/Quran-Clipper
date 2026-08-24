import { NextRequest, NextResponse } from 'next/server';

/**
 * Turns a Pexels *page* link into the media file link the canvas can play.
 *
 * The studio sends people to Pexels to find a background, and what they come
 * back with is the address bar --
 * `https://www.pexels.com/video/majestic-mosque-illuminated-at-night-34918472/`
 * -- which is an HTML page, not a video, so pasting it into the background
 * field did nothing.
 *
 * Reading the file link out of the page HTML is not an option: pexels.com
 * answers Node's fetch with 403 no matter what headers it sends (the block is
 * on the TLS/HTTP2 fingerprint, not the User-Agent), while `api.pexels.com`
 * answers normally. So this goes through the documented API, which needs a free
 * key in `PEXELS_API_KEY`. Without one the route says exactly that, and the
 * panel falls back to telling people to copy the file link by hand.
 */
const ALLOWED_HOSTS = new Set(['www.pexels.com', 'pexels.com']);

/**
 * The rendition to hand back: the largest whose long edge still fits 1080p
 * output, falling back to the smallest on offer when everything is bigger. A 4K
 * clip decoding behind a 1080x1920 canvas costs frame rate during export and
 * buys nothing.
 */
const MAX_LONG_EDGE = 1920;

type PexelsVideoFile = { link?: string; width?: number; height?: number; file_type?: string };

/**
 * Pexels page paths end in `<slug>-<id>`, optionally behind a locale segment:
 * `/video/foo-123/`, `/en-us/photo/bar-456/`.
 */
function parsePexelsPage(page: URL): { kind: 'video' | 'photo'; id: string } | null {
  const parts = page.pathname.split('/').filter(Boolean);
  const kindIndex = parts.findIndex(part => part === 'video' || part === 'photo');
  if (kindIndex === -1) return null;
  const slug = parts[kindIndex + 1];
  const id = slug?.match(/-(\d+)$/)?.[1] ?? (/^\d+$/.test(slug ?? '') ? slug : undefined);
  if (!id) return null;
  return { kind: parts[kindIndex] as 'video' | 'photo', id };
}

function pickVideoFile(files: PexelsVideoFile[]): string | null {
  const usable = files
    .filter(file => typeof file.link === 'string' && file.file_type !== 'video/quicktime')
    .map(file => ({ link: file.link!, longEdge: Math.max(file.width || 0, file.height || 0) }))
    .sort((a, b) => a.longEdge - b.longEdge);
  if (usable.length === 0) return null;
  const withinBudget = usable.filter(file => file.longEdge > 0 && file.longEdge <= MAX_LONG_EDGE);
  return (withinBudget.length > 0 ? withinBudget[withinBudget.length - 1] : usable[0]).link;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'No link given.' }, { status: 400 });
  }

  let page: URL;
  try {
    page = new URL(raw.trim());
  } catch {
    return NextResponse.json({ error: 'That does not look like a link.' }, { status: 400 });
  }

  // Only Pexels pages are looked up. Widening this to arbitrary URLs would turn
  // the studio into a fetch-anything relay for whoever can reach it.
  if (page.protocol !== 'https:' || !ALLOWED_HOSTS.has(page.hostname)) {
    return NextResponse.json(
      { error: 'Only pexels.com page links can be looked up. Paste a direct file link for anything else.' },
      { status: 400 }
    );
  }

  const target = parsePexelsPage(page);
  if (!target) {
    return NextResponse.json(
      { error: 'That Pexels link does not point at a single video or photo.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Looking up Pexels pages needs a free API key. Add PEXELS_API_KEY to .env.local and restart, or open the download menu on Pexels, copy the file link, and paste that here.',
        needsApiKey: true
      },
      { status: 501 }
    );
  }

  try {
    const endpoint =
      target.kind === 'video'
        ? `https://api.pexels.com/videos/videos/${target.id}`
        : `https://api.pexels.com/v1/photos/${target.id}`;
    const res = await fetch(endpoint, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      next: { revalidate: 86400 }
    });

    if (res.status === 401) {
      return NextResponse.json({ error: 'Pexels rejected the API key in PEXELS_API_KEY.' }, { status: 502 });
    }
    if (res.status === 404) {
      return NextResponse.json({ error: 'Pexels has nothing at that link.' }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Pexels returned ${res.status}.` }, { status: 502 });
    }

    const data = await res.json();

    if (target.kind === 'video') {
      const link = pickVideoFile(data?.video_files || []);
      if (!link) return NextResponse.json({ error: 'That Pexels video has no downloadable file.' }, { status: 404 });
      return NextResponse.json({ url: link, type: 'video', credit: data?.user?.name });
    }

    const link = data?.src?.large2x || data?.src?.original;
    if (!link) return NextResponse.json({ error: 'That Pexels photo has no downloadable file.' }, { status: 404 });
    return NextResponse.json({ url: link, type: 'image', credit: data?.photographer });
  } catch {
    return NextResponse.json({ error: 'Could not reach Pexels.' }, { status: 502 });
  }
}
