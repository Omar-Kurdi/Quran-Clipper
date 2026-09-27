import { NextRequest, NextResponse } from 'next/server';
import { getRange } from '@/lib/quranCorpus';
import { versesFromReciterSegments, timingsByVerse, type QuranComTiming } from '@/lib/reciterSegments';
import { quranComFits } from '@/lib/timingAudit';

/** The request's numbers, or null when one it cannot do without is missing. */
function requested(searchParams: URLSearchParams) {
  const number = (name: string, fallback = '') => parseInt(searchParams.get(name) || fallback, 10);
  const params = { surah: number('surah'), start: number('start', '1'), end: number('end'), reciter: number('reciter') };
  return Number.isFinite(params.surah) && Number.isFinite(params.end) && params.reciter ? params : null;
}

/**
 * A timeline from the reciter's own published word timings.
 *
 * Its own route rather than a branch inside `/api/quran/verses`, because it is
 * a different question. That route answers "give me this passage", and it is on
 * the path every load takes; this one answers "time it from the recording", is
 * asked for deliberately, and must not be able to change what a plain load
 * does. Nothing on the upload path reaches it -- these timings describe one
 * specific recording, and against someone else's file they would be fiction.
 */
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  try {
    const params = requested(new URL(req.url).searchParams);
    if (!params) {
      return NextResponse.json({ success: false, error: 'bad request' }, { status: 400 });
    }
    const { surah, start, end, reciter } = params;
    // Only where the audit found quran.com's timings fit their own recording.
    if (!quranComFits(reciter, surah)) {
      return NextResponse.json({ success: false, error: `quran.com's timings for this surah do not match its recording` }, { status: 422 });
    }

    const res = await fetch(
      `https://api.qurancdn.com/api/qdc/audio/reciters/${reciter}/audio_files?chapter=${surah}&segments=true`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 86400 } }
    );
    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'upstream' }, { status: 502 });
    }

    const data = await res.json();
    const file = data?.audio_files?.[0];
    const list: QuranComTiming[] = Array.isArray(file?.verse_timings) ? file.verse_timings : [];

    const timings = timingsByVerse(list);

    // The words and their text come from the corpus, which is the same source
    // a normal load uses -- so the captions read identically and only their
    // times differ.
    const passage = await getRange(surah, start, end);
    const built = versesFromReciterSegments(passage, timings);

    if (built.verses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'no timings for this passage' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      verses: built.verses,
      audioUrl: typeof file?.audio_url === 'string' ? file.audio_url : '',
      totalSeconds: Number.isFinite(file?.duration) ? file.duration / 1000 : 0,
      /** So the studio can say what it got rather than implying it timed everything. */
      coverage: {
        timedWords: built.timedWords,
        boundsOnly: built.boundsOnly,
        missing: built.missing
      }
    });
  } catch {
    return NextResponse.json({ success: false, error: 'failed' }, { status: 502 });
  }
}
