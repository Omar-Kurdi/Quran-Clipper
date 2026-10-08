/**
 * Staying signed in to YouTube: a refresh token, kept by this browser and
 * readable only by the server.
 *
 * Google's access tokens last an hour, so the browser-only sign-in asked again
 * every hour. Keeping access needs a refresh token, and Google gives one only
 * to a server that holds the OAuth client's secret: the pop-up hands the
 * studio a one-time code, the server trades it, with the secret, for a refresh
 * token, and from then on the server turns that into a fresh access token
 * whenever an upload needs one -- no pop-up.
 *
 * The refresh token is kept in an httpOnly cookie on this browser, sealed with
 * AES-256-GCM under a key derived from the client secret, so neither the page's
 * script nor anyone reading the cookie can use it, and the server stores
 * nothing. A cookie, in a personal studio too: a token held on the server
 * would hand a fresh access token to anyone who could reach this route, and a
 * personal studio asks no one who they are.
 *
 * With no `GOOGLE_CLIENT_SECRET` set, none of this is offered and the studio
 * signs in from the browser alone, for an hour at a time, as before.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export const VAULT_COOKIE = 'qc_youtube';
/** The cookie is sent only to these routes. */
export const VAULT_PATH = '/api/youtube';
/** A year: under the 400 days browsers allow, and renewed on every use, so it lasts while it is used. */
export const VAULT_MAX_AGE = 60 * 60 * 24 * 365;

const GOOGLE_OAUTH = 'https://oauth2.googleapis.com';
const TOKEN_ENDPOINT = `${GOOGLE_OAUTH}/token`;
const REVOKE_ENDPOINT = `${GOOGLE_OAUTH}/revoke`;

/** The OAuth client the server can trade codes with, or null when no secret is configured. */
export function vaultClient(env: Record<string, string | undefined> = process.env): { id: string; secret: string } | null {
  const id = (env.NEXT_PUBLIC_YOUTUBE_CLIENT_ID || '').trim();
  const secret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  return id && secret ? { id, secret } : null;
}

const keyFor = (secret: string) => createHash('sha256').update(`quranclipper.youtube.v1:${secret}`).digest();

/** The refresh token, sealed for the cookie: IV, tag and ciphertext, base64url. */
export function seal(refreshToken: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The refresh token a cookie holds, or null when it was not sealed here (a changed secret, or tampered with). */
export function unseal(sealed: string | undefined, secret: string): string | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** What a trade with Google came to. `revoked`: the refresh token no longer works -- disconnected, or expired. */
export type Grant =
  | { ok: true; accessToken: string; expiresIn: number; refreshToken?: string }
  | { ok: false; reason: 'revoked' | 'no-refresh' | 'scope' | 'failed' };

type Fetch = typeof fetch;

async function trade(params: Record<string, string>, fetcher: Fetch): Promise<Record<string, unknown> | 'revoked' | null> {
  try {
    const res = await fetcher(TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams(params) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return body;
    return body.error === 'invalid_grant' ? 'revoked' : null;
  } catch {
    return null;
  }
}

/**
 * Trades the pop-up's one-time code for tokens. Refused without a refresh
 * token -- Google gives one only on a consent screen, which the pop-up asks
 * for -- or without the upload permission, which a person can untick.
 */
export async function exchangeCode(code: string, client: { id: string; secret: string }, scope: string, fetcher: Fetch = fetch): Promise<Grant> {
  const body = await trade(
    { code, client_id: client.id, client_secret: client.secret, redirect_uri: 'postmessage', grant_type: 'authorization_code' },
    fetcher
  );
  if (!body || body === 'revoked' || typeof body.access_token !== 'string') return { ok: false, reason: 'failed' };
  if (!String(body.scope ?? '').split(' ').includes(scope)) return { ok: false, reason: 'scope' };
  if (typeof body.refresh_token !== 'string') return { ok: false, reason: 'no-refresh' };
  return { ok: true, accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600, refreshToken: body.refresh_token };
}

/** A fresh access token from the refresh token. */
export async function refreshAccess(refreshToken: string, client: { id: string; secret: string }, fetcher: Fetch = fetch): Promise<Grant> {
  const body = await trade(
    { refresh_token: refreshToken, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token' },
    fetcher
  );
  if (body === 'revoked') return { ok: false, reason: 'revoked' };
  if (!body || typeof body.access_token !== 'string') return { ok: false, reason: 'failed' };
  return { ok: true, accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

/** Tells Google to forget the grant. Best effort: the cookie is cleared whatever Google answers. */
export async function revoke(refreshToken: string, fetcher: Fetch = fetch): Promise<void> {
  try {
    await fetcher(REVOKE_ENDPOINT, { method: 'POST', body: new URLSearchParams({ token: refreshToken }) });
  } catch (err) {
    // The token is dropped from this browser either way; Google forgets an
    // unused grant on its own after six months.
    console.warn('[youtubeVault] could not revoke the YouTube grant:', (err as Error).message);
  }
}

/**
 * Whether a request may use the vault: a POST from the studio's own page.
 * The custom header cannot be set by a form on another site, and a browser
 * always sends Origin on a cross-site POST.
 */
export function fromStudio(req: { method: string; headers: Headers; nextUrl: { host: string } }): boolean {
  if (req.method !== 'POST' || req.headers.get('x-requested-with') !== 'quranclipper') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.nextUrl.host);
  } catch {
    return false;
  }
}
