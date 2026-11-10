import { NextRequest, NextResponse } from 'next/server';
import { BACKGROUND_QUERIES, chooseBackground, leastLength, sample, type BackgroundCandidate } from '@/lib/backgroundMatch';
import { pickVideoFile, type PexelsVideoFile } from '@/lib/pexelsVideo';

/**
 * A background for a matched clip (`backgroundMatch.ts`): `?seconds=` the
 * clip's length, `&orientation=` portrait, landscape or square.
 *
 * Searches Pexels for a few calm themes, asking only for videos at least as
 * long as the clip, and answers with one of the closest in length -- or, when
 * none is that long, the longest it found, to loop. 404 when Pexels cannot be
 * asked or offers nothing, and the studio chooses from its built-ins instead.
 */
const THEMES_PER_MATCH = 3;
/** What is asked for when nothing is as long as the clip: the longest is then the one to loop. */
const LONG_LOOP_SEC = 120;
/** Pexels allows 200 searches an hour; a search is kept for six, so a run of matches costs few. */
const KEEP_MS = 6 * 60 * 60 * 1000;
const kept = new Map<string, { at: number; videos: BackgroundCandidate[] }>();

type PexelsVideo = { duration?: number; user?: { name?: string }; video_files?: PexelsVideoFile[] };

async function search(apiKey: string, query: string, orientation: string, least: number): Promise<BackgroundCandidate[]> {
  // Asked in steps of a quarter-minute, rounded down, so clips of near lengths share a search;
  // `chooseBackground` then holds each to its own length.
  least = Math.floor(least / 15) * 15;
  const key = `${query}|${orientation}|${least}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.videos;
  const params = new URLSearchParams({ query, orientation, per_page: '80', ...(least > 0 ? { min_duration: String(least) } : {}) });
  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Pexels returned ${res.status}`);
  const data = await res.json();
  const videos = ((data?.videos || []) as PexelsVideo[]).flatMap(video => {
    const url = pickVideoFile(video.video_files || []);
    return url && video.duration ? [{ url, seconds: video.duration, credit: video.user?.name }] : [];
  });
  kept.set(key, { at: Date.now(), videos });
  return videos;
}

export async function GET(req: NextRequest) {
  const seconds = Number(req.nextUrl.searchParams.get('seconds'));
  const orientation = req.nextUrl.searchParams.get('orientation') || 'portrait';
  if (!(seconds > 0) || !['portrait', 'landscape', 'square'].includes(orientation)) {
    return NextResponse.json({ error: 'Give the clip length in seconds and an orientation.' }, { status: 400 });
  }
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'No PEXELS_API_KEY on this server.' }, { status: 404 });
  const themes = sample(BACKGROUND_QUERIES, THEMES_PER_MATCH);
  // Asked at once: long enough for the clip, and -- for when no theme has one,
  // the longest to loop -- two minutes and more, since unasked Pexels offers
  // almost only short clips. `chooseBackground` prefers the long enough.
  const tiers = [...new Set([leastLength(seconds), LONG_LOOP_SEC])];
  const found = await Promise.all(tiers.flatMap(least => themes.map(theme => search(apiKey, theme, orientation, least).catch(() => []))));
  const chosen = chooseBackground(found.flat(), seconds);
  if (!chosen) return NextResponse.json({ error: 'Pexels offered no background.' }, { status: 404 });
  return NextResponse.json({ ...chosen, looped: chosen.seconds < leastLength(seconds) });
}
