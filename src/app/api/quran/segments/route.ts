import { NextRequest, NextResponse } from 'next/server';
import { getRange } from '@/lib/quranCorpus';
import { versesFromReciterSegments, ReciterVerseTiming } from '@/lib/reciterSegments';

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

interface ApiTiming {
  verse_key?: string;
  timestamp_from?: number;
  timestamp_to?: number;
  segments?: number[][];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const surah = parseInt(searchParams.get('surah') || '', 10);
    const start = parseInt(searchParams.get('start') || '1', 10);
    const end = parseInt(searchParams.get('end') || '', 10);
    const reciter = parseInt(searchParams.get('reciter') || '', 10);

    if (!Number.isFinite(surah) || !Number.isFinite(end) || !reciter) {
      return NextResponse.json({ success: false, error: 'bad request' }, { status: 400 });
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
    const list: ApiTiming[] = Array.isArray(file?.verse_timings) ? file.verse_timings : [];

    const timings = new Map<string, ReciterVerseTiming>();
    for (const entry of list) {
      if (!entry?.verse_key) continue;
      timings.set(entry.verse_key, {
        from: entry.timestamp_from ?? 0,
        to: entry.timestamp_to ?? 0,
        segments: Array.isArray(entry.segments) ? entry.segments : undefined
      });
    }

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
