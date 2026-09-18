import { NextRequest, NextResponse } from 'next/server';
import { fetchSyncSources, type AyahRange } from '@/lib/contentSync';

/**
 * The current Quran content for some ayahs, to check a stored copy against.
 *
 * Saved projects are checked by `/api/projects` itself. This is for the one
 * stored copy the server never sees -- the auto-saved draft in the browser --
 * which asks for what is current and applies `applyContentSync` on its own
 * side. Read-only: it changes nothing here.
 *
 *   ?ranges=2:121-134,3:1-9   the ayahs to fetch, one range per surah
 *   &ids=85,158               editions whose text the draft holds
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const ranges: AyahRange[] = (params.get('ranges') || '')
    .split(',')
    .map(part => /^(\d{1,3}):(\d{1,3})-(\d{1,3})$/.exec(part.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map(m => ({ surah: Number(m[1]), start: Number(m[2]), end: Number(m[3]) }))
    .filter(r => r.surah >= 1 && r.surah <= 114 && r.start >= 1 && r.end >= r.start)
    .slice(0, 4);
  const ids = (params.get('ids') || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id))
    .slice(0, 5);
  if (!ranges.length) {
    return NextResponse.json({ success: false, error: 'No ayahs asked for.' }, { status: 400 });
  }
  try {
    const sources = await fetchSyncSources(ranges, ids);
    return sources
      ? NextResponse.json({ success: true, ...sources })
      : NextResponse.json({ success: false, error: 'The upstream could not be reached.' }, { status: 502 });
  } catch {
    return NextResponse.json({ success: false, error: 'Could not read the current content.' }, { status: 500 });
  }
}
