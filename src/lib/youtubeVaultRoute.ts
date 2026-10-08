/**
 * What the three `/api/youtube/*` routes share: who may ask, and the cookie
 * the refresh token travels in. See `youtubeVault` for why it is a cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { VAULT_COOKIE, VAULT_MAX_AGE, VAULT_PATH, fromStudio, unseal, vaultClient } from './youtubeVault';

/** The client and the refresh token this browser holds, or a response saying why there is nothing to do. */
export function vaultRequest(req: NextRequest):
  | { refused: NextResponse }
  | { client: { id: string; secret: string } | null; refreshToken: string | null } {
  if (!fromStudio(req)) return { refused: NextResponse.json({ error: 'Not from the studio.' }, { status: 403 }) };
  const client = vaultClient();
  return { client, refreshToken: client ? unseal(req.cookies.get(VAULT_COOKIE)?.value, client.secret) : null };
}

const secure = (req: NextRequest) =>
  (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')) === 'https';

/** Keeps the sealed token on this browser for another year. */
export function keepCookie(res: NextResponse, req: NextRequest, sealed: string): NextResponse {
  res.cookies.set(VAULT_COOKIE, sealed, { httpOnly: true, sameSite: 'lax', secure: secure(req), path: VAULT_PATH, maxAge: VAULT_MAX_AGE });
  return res;
}

export function dropCookie(res: NextResponse, req: NextRequest): NextResponse {
  res.cookies.set(VAULT_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: secure(req), path: VAULT_PATH, maxAge: 0 });
  return res;
}
