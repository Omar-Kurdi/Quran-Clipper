/**
 * What the `/api/tiktok/*` routes share: who may ask, the TikTok app, the
 * tokens this browser holds, and the cookie they travel in. See `tiktokVault`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fromStudio } from './youtubeVault';
import { dropCookie, keepCookie } from './youtubeVaultRoute';
import { TIKTOK_COOKIE, TIKTOK_PATH, freshHeld, sealHeld, tiktokClient, unsealHeld, type Held, type TikTokClient } from './tiktokVault';

const JAR = { name: TIKTOK_COOKIE, path: TIKTOK_PATH };

/** The address TikTok sends the sign-in back to: this studio's own, as the browser reached it. */
export function redirectUri(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.nextUrl.host;
  return `${proto}://${host}${TIKTOK_PATH}/callback`;
}

/** The app and the tokens this browser holds, or a response saying why there is nothing to do. */
export function tiktokRequest(req: NextRequest): { refused: NextResponse } | { client: TikTokClient | null; held: Held | null } {
  if (!fromStudio(req)) return { refused: NextResponse.json({ error: 'Not from the studio.' }, { status: 403 }) };
  const client = tiktokClient();
  return { client, held: client ? unsealHeld(req.cookies.get(TIKTOK_COOKIE)?.value, client.secret) : null };
}

/**
 * A live access token for this browser, refreshed if it was running out, or
 * a response saying it must sign in again -- in which case a refresh token
 * TikTok no longer honours is dropped.
 */
export async function liveAccess(req: NextRequest): Promise<{ refused: NextResponse } | { client: TikTokClient; held: Held; renewed: number | null }> {
  const asked = tiktokRequest(req);
  if ('refused' in asked) return asked;
  if (!asked.client) return { refused: NextResponse.json({ error: 'not-configured' }, { status: 404 }) };
  if (!asked.held) return { refused: NextResponse.json({ error: 'signin' }, { status: 401 }) };
  const grant = await freshHeld(asked.held, asked.client);
  if (!grant.ok) {
    const res = NextResponse.json({ error: grant.reason === 'revoked' ? 'signin' : 'other' }, { status: grant.reason === 'revoked' ? 401 : 502 });
    return { refused: grant.reason === 'revoked' ? dropTikTok(res, req) : res };
  }
  return { client: asked.client, held: grant.held, renewed: grant.held === asked.held ? null : grant.keepFor ?? DEFAULT_KEEP };
}

/** Half a year: how long TikTok's refresh tokens last. */
const DEFAULT_KEEP = 60 * 60 * 24 * 180;

/** Keeps the tokens on this browser, sealed, for as long as the refresh token lasts. */
export function keepTikTok(res: NextResponse, req: NextRequest, held: Held, client: TikTokClient, keepFor = DEFAULT_KEEP): NextResponse {
  return keepCookie(res, req, sealHeld(held, client.secret), JAR, keepFor);
}

export function dropTikTok(res: NextResponse, req: NextRequest): NextResponse {
  return dropCookie(res, req, JAR);
}
