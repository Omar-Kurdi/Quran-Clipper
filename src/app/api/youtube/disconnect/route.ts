import { NextRequest, NextResponse } from 'next/server';
import { revoke } from '@/lib/youtubeVault';
import { dropCookie, vaultRequest } from '@/lib/youtubeVaultRoute';

export const dynamic = 'force-dynamic';

/** Revokes the grant at Google and drops it from this browser -- the latter whatever Google answers. */
export async function POST(req: NextRequest) {
  const vault = vaultRequest(req);
  if ('refused' in vault) return vault.refused;
  if (vault.refreshToken) await revoke(vault.refreshToken);
  return dropCookie(NextResponse.json({ connected: false }), req);
}
