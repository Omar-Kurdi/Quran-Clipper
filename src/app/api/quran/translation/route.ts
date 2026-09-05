import { NextRequest, NextResponse } from 'next/server';
import { quranApiFetch } from '@/lib/quranApi';
import { cleanHtml } from '@/lib/quranCorpus';

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

interface ApiVerse {
  verse_key?: string;
  verse_number?: number;
  translations?: { resource_id?: number; text?: string }[];
}

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

    const { res } = await quranApiFetch(
      `/verses/by_chapter/${surah}?translations=${ids.join(',')}&fields=verse_key&per_page=300`,
      { next: { revalidate: 86400 } }
    );
    if (!res?.ok) return NextResponse.json({ success: false, verses: {} }, { status: 502 });

    const data = await res.json();
    const list: ApiVerse[] = Array.isArray(data?.verses) ? data.verses : [];

    const verses: Record<string, Record<string, string>> = {};
    for (const verse of list) {
      const key = verse.verse_key;
      const number = verse.verse_number ?? 0;
      if (!key || number < start || number > end) continue;
      const texts: Record<string, string> = {};
      for (const translation of verse.translations || []) {
        // An id quran.com no longer serves simply does not come back; the
        // caption then shows the translations that did, rather than a gap.
        if (typeof translation?.resource_id !== 'number') continue;
        const text = cleanHtml(translation.text || '');
        if (text) texts[String(translation.resource_id)] = text;
      }
      if (Object.keys(texts).length) verses[key] = texts;
    }

    return NextResponse.json({ success: true, verses });
  } catch {
    return NextResponse.json({ success: false, verses: {} }, { status: 502 });
  }
}
