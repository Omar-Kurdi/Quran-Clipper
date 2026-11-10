/**
 * Staying signed in to TikTok: the tokens, kept by this browser and readable
 * only by the server -- the same arrangement as YouTube's (`youtubeVault`).
 *
 * TikTok's token endpoints need the client secret, so the server makes every
 * call: it trades the sign-in's code for an access token (two hours) and a
 * refresh token (half a year), seals both in an httpOnly cookie on this
 * browser, and from then on uses them for each upload and refreshes them as
 * they run out. The page never sees either. TikTok replaces the refresh token
 * on every refresh and refuses the old one from then on, so the cookie is
 * sealed again each time it is used.
 */

import { seal, unseal } from './youtubeVault';
import { TIKTOK_SCOPES } from './tiktokUpload';

export const TIKTOK_COOKIE = 'qc_tiktok';
/** The sign-in's `state`, kept for the few minutes the pop-up is open. */
export const TIKTOK_STATE_COOKIE = 'qc_tiktok_state';
/** Both cookies are sent only to these routes. */
export const TIKTOK_PATH = '/api/tiktok';
const PURPOSE = 'tiktok';

const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com';
const TOKEN_ENDPOINT = `${API}/v2/oauth/token/`;
const REVOKE_ENDPOINT = `${API}/v2/oauth/revoke/`;

export type TikTokClient = { key: string; secret: string };

/** The TikTok app the server signs in with, or null when none is configured -- then nothing is offered. */
export function tiktokClient(env: Record<string, string | undefined> = process.env): TikTokClient | null {
  const key = (env.TIKTOK_CLIENT_KEY || '').trim();
  const secret = (env.TIKTOK_CLIENT_SECRET || '').trim();
  return key && secret ? { key, secret } : null;
}

/** TikTok's sign-in page for this app, returning to `redirectUri` with `state`. */
export function authorizeUrl(client: TikTokClient, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_key: client.key, response_type: 'code', scope: TIKTOK_SCOPES, redirect_uri: redirectUri, state
  }).toString();
  return url.toString();
}

/** What the cookie holds: the refresh token, and the access token while it lasts. */
export type Held = { refresh: string; access: string; until: number };

export function sealHeld(held: Held, secret: string): string {
  return seal(JSON.stringify(held), secret, PURPOSE);
}

/** The tokens a cookie holds, or null when it was not sealed here or holds something else. */
export function unsealHeld(sealed: string | undefined, secret: string): Held | null {
  const raw = unseal(sealed, secret, PURPOSE);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { refresh, access, until } = parsed as Record<string, unknown>;
  return typeof refresh === 'string' && typeof access === 'string' && typeof until === 'number' ? { refresh, access, until } : null;
}

/**
 * What a trade with TikTok came to: the tokens, and for new ones how long the
 * refresh token lasts. `revoked`: the refresh token no longer works --
 * disconnected, replaced or expired.
 */
export type Grant =
  | { ok: true; held: Held; keepFor?: number }
  | { ok: false; reason: 'revoked' | 'scope' | 'failed' };

type Fetch = typeof fetch;

async function trade(params: Record<string, string>, fetcher: Fetch, now: number): Promise<Grant> {
  try {
    const res = await fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
      return { ok: false, reason: body.error === 'invalid_grant' ? 'revoked' : 'failed' };
    }
    if (!String(body.scope ?? '').split(',').map(s => s.trim()).includes('video.upload')) return { ok: false, reason: 'scope' };
    const expiresIn = Number(body.expires_in) || 7200;
    return {
      ok: true,
      held: { refresh: body.refresh_token, access: body.access_token, until: now + expiresIn * 1000 },
      keepFor: Number(body.refresh_expires_in) || 60 * 60 * 24 * 180
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Trades the sign-in's code for tokens. Refused without the upload
 * permission, which a person can untick on TikTok's consent page.
 */
export function exchangeCode(code: string, client: TikTokClient, redirectUri: string, fetcher: Fetch = fetch, now = Date.now()): Promise<Grant> {
  return trade(
    { client_key: client.key, client_secret: client.secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri },
    fetcher, now
  );
}

/** The tokens as they are if the access token has a few minutes left, else fresh ones from the refresh token. */
export async function freshHeld(held: Held, client: TikTokClient, fetcher: Fetch = fetch, now = Date.now()): Promise<Grant> {
  if (held.until - now > 5 * 60_000) return { ok: true, held };
  return trade(
    { client_key: client.key, client_secret: client.secret, grant_type: 'refresh_token', refresh_token: held.refresh },
    fetcher, now
  );
}

/** Tells TikTok to forget the grant. Best effort: the cookie is cleared whatever TikTok answers. */
export async function revoke(held: Held, client: TikTokClient, fetcher: Fetch = fetch): Promise<void> {
  try {
    await fetcher(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: client.key, client_secret: client.secret, token: held.access })
    });
  } catch (err) {
    console.warn('[tiktokVault] could not revoke the TikTok grant:', (err as Error).message);
  }
}

/** TikTok's answer to an API call: its `data`, and `error.code`, which is `ok` on success. */
export type ApiAnswer = { status: number; data: Record<string, unknown>; code: string };

/** Calls one of TikTok's JSON endpoints with the person's access token. */
export async function tiktokApi(path: string, access: string, body: unknown, fetcher: Fetch = fetch): Promise<ApiAnswer> {
  try {
    const res = await fetcher(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body)
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
    return { status: res.status, data: json.data ?? {}, code: json.error?.code ?? (res.ok ? 'ok' : 'unknown') };
  } catch {
    return { status: 0, data: {}, code: 'network' };
  }
}
