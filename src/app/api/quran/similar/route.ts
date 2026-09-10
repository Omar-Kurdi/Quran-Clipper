import { NextRequest, NextResponse } from 'next/server';
import { similarPhrasesIn, mutashabihatAvailable } from '@/lib/mutashabihat';

/**
 * Where else this caption's words occur in the Quran.
 *
 * Read-only and cheap -- one lookup in a file already in memory -- so it is a
 * route rather than part of the verses payload: it is asked for while someone
 * is reviewing a caption, not while a timeline is being built, and most
 * captions have no answer at all.
 */
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const verse = (searchParams.get('verse') || '').trim();
  if (!/^\d+:\d+$/.test(verse)) {
    return NextResponse.json({ success: false, phrases: [] }, { status: 400 });
  }

  const from = Number(searchParams.get('from'));
  const to = Number(searchParams.get('to'));
  const words =
    Number.isFinite(from) && Number.isFinite(to) && to >= from ? { from, to } : undefined;

  return NextResponse.json({
    success: true,
    /** False when the QUL export is not on this machine, so the UI can stay quiet. */
    available: mutashabihatAvailable(),
    phrases: similarPhrasesIn(verse, words)
  });
}
