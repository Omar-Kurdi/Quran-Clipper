import { NextRequest, NextResponse } from 'next/server';
import { revoke } from '@/lib/tiktokVault';
import { dropTikTok, tiktokRequest } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/** Revokes the grant at TikTok and drops it from this browser -- the latter whatever TikTok answers. */
export async function POST(req: NextRequest) {
  const asked = tiktokRequest(req);
  if ('refused' in asked) return asked.refused;
  if (asked.client && asked.held) await revoke(asked.held, asked.client);
  return dropTikTok(NextResponse.json({ connected: false }), req);
}
