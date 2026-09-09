import { NextRequest, NextResponse } from 'next/server';
import { quranApiFetch } from '@/lib/quranApi';
import { cleanHtml } from '@/lib/quranCorpus';
import { CLEAR_QURAN_ID, clearQuranSurah } from '@/lib/clearQuran';

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

    /**
     * Fills in The Clear Quran from this machine.
     *
     * Applied after the upstream rather than instead of it, so an upstream that
     * does carry 131 is preferred and this becomes dead weight the moment the
     * Foundation grants access. Written from the *local* surah's own length
     * rather than from the response, because the response may hold no verses at
     * all -- asking the open API for 131 alone comes back empty, which is the
     * case this exists for.
     */
    const fillClearQuran = (into: Record<string, Record<string, string>>) => {
      if (!ids.includes(CLEAR_QURAN_ID)) return into;
      const local = clearQuranSurah(surah);
      if (!local) return into;
      const last = Math.min(end, local.length);
      for (let ayah = Math.max(1, start); ayah <= last; ayah++) {
        const text = local[ayah - 1];
        if (!text) continue;
        const key = `${surah}:${ayah}`;
        const texts = into[key] || (into[key] = {});
        if (!texts[CLEAR_QURAN_ID]) texts[CLEAR_QURAN_ID] = text;
      }
      return into;
    };

    const { res } = await quranApiFetch(
      `/verses/by_chapter/${surah}?translations=${ids.join(',')}&fields=verse_key&per_page=300`,
      { next: { revalidate: 86400 } }
    );
    // A failed upstream still leaves the local translation answerable, which is
    // the difference between a caption in one language and no caption at all.
    if (!res?.ok) {
      const local = fillClearQuran({});
      return Object.keys(local).length
        ? NextResponse.json({ success: true, verses: local })
        : NextResponse.json({ success: false, verses: {} }, { status: 502 });
    }

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

    return NextResponse.json({ success: true, verses: fillClearQuran(verses) });
  } catch {
    return NextResponse.json({ success: false, verses: {} }, { status: 502 });
  }
}
