import { NextRequest, NextResponse } from 'next/server';
import { matchQueue } from '@/lib/matchQueue';

export const dynamic = 'force-dynamic';

/**
 * Where one match stands in the queue: `position` 0 while it runs, 1 when it
 * is next, null once it is done or was never queued. See `matchQueue`.
 */
export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get('ticket') || '';
  return NextResponse.json({ ...matchQueue.status(ticket), waiting: matchQueue.length });
}
