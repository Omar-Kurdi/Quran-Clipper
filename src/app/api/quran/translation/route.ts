import { NextRequest, NextResponse } from 'next/server';
import { fetchTranslationTexts } from '@/lib/translationTexts';

/**
 * The text of one or more translations, for one passage.
 *
 * Separate from `/api/quran/verses` on purpose: a translation can be chosen
 * long after the timeline was built -- including for a timeline built by the
 * aligner from an uploaded recitation, which never went through the verses
 * route at all. So this is keyed on the passage rather than on how the
 * captions got here, and the caller merges what comes back by verse key.
 */
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const surah = parseInt(searchParams.get('surah') || '1', 10);
    const start = parseInt(searchParams.get('start') || '1', 10);
    const end = parseInt(searchParams.get('end') || '286', 10);
    // Ids are quran.com resource ids. Anything that is not a number is dropped
    // rather than passed on -- this string goes into a URL.
    const ids = (searchParams.get('ids') || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => /^\d+$/.test(id))
      .slice(0, 5);

    if (!ids.length || !Number.isFinite(surah)) {
      return NextResponse.json({ success: false, verses: {} }, { status: 400 });
    }

    const verses = await fetchTranslationTexts(surah, start, end, ids);
    return verses
      ? NextResponse.json({ success: true, verses })
      : NextResponse.json({ success: false, verses: {} }, { status: 502 });
  } catch {
    return NextResponse.json({ success: false, verses: {} }, { status: 502 });
  }
}
