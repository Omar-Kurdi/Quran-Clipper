import { NextRequest, NextResponse } from 'next/server';
import { tiktokRequest } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/** Whether this studio offers TikTok, and whether this browser is signed in to it. */
export async function POST(req: NextRequest) {
  const asked = tiktokRequest(req);
  if ('refused' in asked) return asked.refused;
  return NextResponse.json({ configured: Boolean(asked.client), connected: Boolean(asked.held) });
}
