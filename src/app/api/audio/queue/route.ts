import { NextRequest, NextResponse } from 'next/server';
import { matchQueue } from '@/lib/matchQueue';
import { sidecarProgress } from '@/lib/forcedAligner';
import { defaultAsrServiceUrl } from '@/app/api/audio/match/route';

export const dynamic = 'force-dynamic';

/**
 * Where one match stands in the queue: `position` 0 while it runs, 1 when it
 * is next, null once it is done or was never queued. See `matchQueue`. While
 * it runs, `progress` is where the aligner has got to with it, when it says.
 */
export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') || '';
  const status = matchQueue.status(ticket);
  const progress = status.position === 0 ? await sidecarProgress(defaultAsrServiceUrl(), ticket) : null;
  return NextResponse.json({ ...status, waiting: matchQueue.length, progress });
}
