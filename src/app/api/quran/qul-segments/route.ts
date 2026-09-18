import { NextRequest, NextResponse } from 'next/server';
import { getRange } from '@/lib/quranCorpus';
import { versesFromReciterSegments } from '@/lib/reciterSegments';
import { qulReciters, qulSurah } from '@/lib/qulRecitations';

/**
 * A timeline from QUL's word timings for a built-in reciter, with QUL's audio.
 *
 * The counterpart of `/api/quran/segments`, which answers the same question
 * from quran.com. A separate route and a separate button, so the two can be
 * loaded one after the other on the same passage and compared -- and so that
 * neither can change what the other, or a plain load, does.
 *
 * With no `surah`, it lists the reciters this machine holds an export for, so
 * the studio only offers the button where it can work.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (!searchParams.has('surah')) {
    return NextResponse.json({ success: true, reciters: qulReciters() });
  }

  const surah = parseInt(searchParams.get('surah') || '', 10);
  const start = parseInt(searchParams.get('start') || '1', 10);
  const end = parseInt(searchParams.get('end') || '', 10);
  const reciter = searchParams.get('reciter') || '';
  if (!Number.isFinite(surah) || !Number.isFinite(start) || !Number.isFinite(end) || !reciter) {
    return NextResponse.json({ success: false, error: 'bad request' }, { status: 400 });
  }

  const held = qulSurah(reciter, surah);
  if (!held) {
    return NextResponse.json({ success: false, error: 'no QUL export for this reciter and surah' }, { status: 404 });
  }

  try {
    // Words and text from the corpus, as every other load: only the times
    // and the recording differ.
    const passage = await getRange(surah, start, end);
    const built = versesFromReciterSegments(passage, held.timings);
    if (built.verses.length === 0) {
      return NextResponse.json({ success: false, error: 'no timings for this passage' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      verses: built.verses,
      audioUrl: held.audioUrl,
      totalSeconds: held.lastMs / 1000,
      coverage: { timedWords: built.timedWords, boundsOnly: built.boundsOnly, missing: built.missing }
    });
  } catch {
    return NextResponse.json({ success: false, error: 'failed' }, { status: 502 });
  }
}
