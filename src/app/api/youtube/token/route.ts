import { NextRequest, NextResponse } from 'next/server';
import { refreshAccess, seal } from '@/lib/youtubeVault';
import { dropCookie, keepCookie, vaultRequest } from '@/lib/youtubeVaultRoute';

export const dynamic = 'force-dynamic';

/**
 * A fresh access token from the refresh token this browser holds, and whether
 * staying signed in is offered here at all. A refresh token Google no longer
 * honours -- disconnected from the Google account, or a week old while the
 * consent screen is in testing -- is dropped, and the studio signs in again.
 */
export async function POST(req: NextRequest) {
  const vault = vaultRequest(req);
  if ('refused' in vault) return vault.refused;
  if (!vault.client) return NextResponse.json({ configured: false, connected: false });
  if (!vault.refreshToken) return NextResponse.json({ configured: true, connected: false });
  const grant = await refreshAccess(vault.refreshToken, vault.client);
  if (!grant.ok) {
    const res = NextResponse.json({ configured: true, connected: false, expired: grant.reason === 'revoked' });
    return grant.reason === 'revoked' ? dropCookie(res, req) : res;
  }
  const res = NextResponse.json({ configured: true, connected: true, accessToken: grant.accessToken, expiresIn: grant.expiresIn });
  return keepCookie(res, req, seal(vault.refreshToken, vault.client.secret));
}
