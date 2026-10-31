import { NextRequest, NextResponse } from 'next/server';
import { fetchTafsirTexts } from '@/lib/tafsirTexts';

/**
 * The brief tafsir of one passage, for the captions to show under the
 * translation when asked. Keyed on the passage, as `/api/quran/translation`
 * is, and merged by verse key; the studio keeps what comes back in memory only.
 */
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const surah = parseInt(searchParams.get('surah') || '', 10);
    const start = parseInt(searchParams.get('start') || '1', 10);
    const end = parseInt(searchParams.get('end') || '286', 10);
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
      return NextResponse.json({ success: false, verses: {} }, { status: 400 });
    }
    const verses = await fetchTafsirTexts(surah, start, end);
    return verses
      ? NextResponse.json({ success: true, verses })
      : NextResponse.json({ success: false, verses: {} }, { status: 502 });
  } catch {
    return NextResponse.json({ success: false, verses: {} }, { status: 502 });
  }
}
