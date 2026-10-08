import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, seal } from '@/lib/youtubeVault';
import { keepCookie, vaultRequest } from '@/lib/youtubeVaultRoute';
import { YOUTUBE_UPLOAD_SCOPE } from '@/lib/youtubeUpload';

export const dynamic = 'force-dynamic';

/** Trades the sign-in pop-up's one-time code for a refresh token kept on this browser, and answers with an access token. */
export async function POST(req: NextRequest) {
  const vault = vaultRequest(req);
  if ('refused' in vault) return vault.refused;
  if (!vault.client) return NextResponse.json({ error: 'not-configured' }, { status: 404 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: unknown };
  if (typeof code !== 'string' || !code) return NextResponse.json({ error: 'no-code' }, { status: 400 });
  const grant = await exchangeCode(code, vault.client, YOUTUBE_UPLOAD_SCOPE);
  if (!grant.ok || !grant.refreshToken) return NextResponse.json({ error: grant.ok ? 'no-refresh' : grant.reason }, { status: 400 });
  const res = NextResponse.json({ accessToken: grant.accessToken, expiresIn: grant.expiresIn });
  return keepCookie(res, req, seal(grant.refreshToken, vault.client.secret));
}
