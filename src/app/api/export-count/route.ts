import { NextRequest, NextResponse } from 'next/server';
import { createCountLimiter, exportCountFrom } from '@/lib/exportCounts';
import { visitorFrom } from '@/lib/matchQueue';
import { addExportCount } from '@/lib/exportCountStore';

/** Held in memory, per server process: see `createCountLimiter`. */
const mayCount = createCountLimiter();

/**
 * Counts one finished export, on every studio, public included -- unlike
 * `/api/exports`, which keeps a named record and is closed in public. Nothing
 * that says who exported is stored. The export itself never waits on this.
 */
export async function POST(req: NextRequest) {
  const count = exportCountFrom(await req.json().catch(() => null));
  if (!count) return NextResponse.json({ success: false, error: 'Not an export count.' }, { status: 400 });
  if (!mayCount(visitorFrom(req.headers))) {
    return NextResponse.json({ success: false, error: 'Too many exports counted from here.' }, { status: 429 });
  }
  try {
    await addExportCount(count);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Could not count it.' }, { status: 500 });
  }
}
