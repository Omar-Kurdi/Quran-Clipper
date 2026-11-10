import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { TIKTOK_PATH, TIKTOK_STATE_COOKIE, authorizeUrl, tiktokClient } from '@/lib/tiktokVault';
import { redirectUri } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/**
 * Where the sign-in pop-up starts: off to TikTok's consent page, with a fresh
 * `state` kept in a short-lived cookie for the callback to check -- so a code
 * only counts when this browser asked for it.
 */
export async function GET(req: NextRequest) {
  const client = tiktokClient();
  if (!client) return NextResponse.json({ error: 'not-configured' }, { status: 404 });
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(authorizeUrl(client, redirectUri(req), state));
  const secure = (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';
  res.cookies.set(TIKTOK_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure, path: TIKTOK_PATH, maxAge: 600 });
  return res;
}
