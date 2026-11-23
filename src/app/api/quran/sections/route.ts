import { NextRequest, NextResponse } from 'next/server';
import { quranApiJson } from '@/lib/quranApi';
import { rukuStartsOf, topicSections, type SectionKind, type SurahSection } from '@/lib/clipSuggestions';
import { studioMode } from '@/lib/studioMode';
import { surahThemes } from '@/lib/surahThemes';

/**
 * The sections of a surah that suggested clips are made of (`suggestClips`):
 * its topic groups, each with its topic, where this machine has them
 * (`surahThemes`) and the studio is the owner's own; otherwise its rukus,
 * from the verses' `ruku_number` as the Quran Foundation gives it.
 */
export const dynamic = 'force-dynamic';

type Verses = { verses?: { verse_number?: number; ruku_number?: number }[] };

export async function GET(req: NextRequest) {
  const surah = parseInt(req.nextUrl.searchParams.get('surah') || '', 10);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    return NextResponse.json({ success: false, sections: [] }, { status: 400 });
  }
  const themes = studioMode() === 'public' ? null : await surahThemes(surah);
  if (themes) return answer('topic', topicSections(themes));
  const { data } = await quranApiJson<Verses>(
    `/verses/by_chapter/${surah}?fields=ruku_number&per_page=300`,
    { next: { revalidate: 86400 } },
    found => rukuStartsOf(found.verses ?? []).length > 0
  );
  const starts = rukuStartsOf(data?.verses ?? []);
  return starts.length
    ? answer('ruku', starts.map(first => ({ first })))
    : NextResponse.json({ success: false, sections: [] }, { status: 502 });
}

const answer = (kind: SectionKind, sections: SurahSection[]) => NextResponse.json({ success: true, kind, sections });
