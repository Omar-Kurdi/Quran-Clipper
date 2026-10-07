import { NextRequest, NextResponse } from 'next/server';
import { runRegroup, screenBreaksFrom, AlignRequestError } from '@/lib/forcedAligner';
import { defaultAsrServiceUrl, timelineBody } from '@/app/api/audio/match/route';
import type { MatchResult } from '@/lib/matchTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The shape the sidecar's ids take; anything else is not worth a round trip. */
const REGROUP_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Cut a forced alignment into captions again at another screen-break setting.
 *
 * The sidecar keeps each match it makes for a while (`regroup.py`), so Fewer /
 * More re-runs only the grouping: a fraction of a second, against a whole new
 * match. Answers exactly as `/api/audio/match` does, so the studio applies the
 * result the same way.
 *
 * A GET, because it changes nothing: the same id and setting always answer
 * the same. Not queued behind other matches, and open on a public studio: the
 * id is unguessable and the work is the cheap part of a match. 410 means the sidecar
 * no longer holds this one -- restarted, or it made room for newer matches --
 * and the studio offers to match again.
 */
export async function GET(req: NextRequest) {
  const form = req.nextUrl.searchParams;
  const id = String(form.get('id') || '');
  if (!REGROUP_ID.test(id)) {
    return NextResponse.json({ success: false, error: 'No match to re-cut.' }, { status: 400 });
  }
  const provider = String(form.get('provider') || 'align');
  const surah = Number(form.get('surah')) || 1;
  const start = Number(form.get('start')) || 1;
  const end = Number(form.get('end')) || start;

  let result: MatchResult;
  try {
    result = await runRegroup({
      serviceUrl: defaultAsrServiceUrl(),
      regroupId: id,
      breaks: screenBreaksFrom(form.get('breaks')),
      surah,
      start,
      end
    });
  } catch (err) {
    const expired = err instanceof AlignRequestError && (err.code === 'regroup_expired' || / \(404\)/.test(err.message));
    return NextResponse.json(
      { success: false, provider, expired, error: (err as Error).message },
      { status: expired ? 410 : 502 }
    );
  }

  const built = await timelineBody(result, {
    provider,
    selectedSurah: surah,
    windowStart: Number(form.get('windowStart')) || 0,
    clientDuration: Number(form.get('audioDuration') || 0),
    wholeClip: form.get('wholeClip') === '1'
  });
  if ('error' in built) {
    return NextResponse.json({ success: false, provider, error: built.error }, { status: built.status });
  }
  return NextResponse.json({
    success: true,
    method: 'ctc_forced_alignment',
    provider,
    needsReview: Boolean(result.warning),
    ...built.body,
    timedFrom: null,
    pausesFromAudio: false,
    alignerSkipped: false
  });
}
