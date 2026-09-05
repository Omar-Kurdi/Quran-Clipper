/**
 * Where the Quran text and its translations come from.
 *
 * Two upstreams answer the same shapes, and which one is in use decides what
 * the studio can offer:
 *
 *  - `api.quran.com/api/v4`, open and keyless. It publishes 126 translations
 *    and needs no setup, which is why it is the default and always the
 *    fallback. What it does *not* carry is The Clear Quran (Dr. Mustafa
 *    Khattab, resource 131): it is absent from the resource list, and asking
 *    for its text returns HTTP 200 with the field silently omitted. That is
 *    the whole reason the studio's default drifted to Saheeh International.
 *
 *  - The Quran Foundation content API, which is what quran.com itself reads
 *    and does carry 131. It needs a free client id and secret, exchanged for a
 *    short-lived token; set them and everything here routes through it.
 *
 * Server-only: the secret must never reach the browser, so nothing in this
 * module may be imported from a client component.
 */

export type QuranApiSource = 'public' | 'foundation';

const PUBLIC_BASE = 'https://api.quran.com/api/v4';

/** Pre-live is the Foundation's sandbox; it holds the same content behind separate credentials. */
const FOUNDATION = {
  live: {
    content: 'https://apis.quran.foundation/content/api/v4',
    oauth: 'https://oauth2.quran.foundation/oauth2/token'
  },
  prelive: {
    content: 'https://apis-prelive.quran.foundation/content/api/v4',
    oauth: 'https://prelive-oauth2.quran.foundation/oauth2/token'
  }
} as const;

const clientId = () => (process.env.QURAN_FOUNDATION_CLIENT_ID || '').trim();
const clientSecret = () => (process.env.QURAN_FOUNDATION_CLIENT_SECRET || '').trim();

const foundationHosts = () =>
  (process.env.QURAN_FOUNDATION_ENV || 'live').trim().toLowerCase() === 'prelive'
    ? FOUNDATION.prelive
    : FOUNDATION.live;

/** True once both halves of a client credential are present. Neither alone is usable. */
export const quranApiConfigured = (): boolean => Boolean(clientId() && clientSecret());

export const quranApiSource = (): QuranApiSource => (quranApiConfigured() ? 'foundation' : 'public');

/**
 * The English translation a caption's own `translation` field holds.
 *
 * 131 is The Clear Quran, and it only exists on the Foundation API -- asking
 * the public one for it produces captions with no translation at all, which is
 * worse than a different translation. So the default follows the upstream, and
 * an explicit `QURAN_TRANSLATION_ID` overrides both.
 *
 * `NEXT_PUBLIC_QURAN_TRANSLATION_ID` is the same value where the browser can
 * read it; the studio needs to know which id its captions already carry, and
 * that is the one piece of this the client legitimately has to see.
 */
export function defaultTranslationId(): string {
  const explicit = (
    process.env.QURAN_TRANSLATION_ID ||
    process.env.NEXT_PUBLIC_QURAN_TRANSLATION_ID ||
    ''
  ).trim();
  if (explicit) return explicit;
  return quranApiConfigured() ? '131' : '20';
}

interface CachedToken {
  value: string;
  /** Epoch milliseconds. Renewed early rather than on expiry. */
  expiresAt: number;
}

let token: CachedToken | null = null;
let pending: Promise<string | null> | null = null;

/** A minute of slack, so a token cannot expire between being chosen and being used. */
const RENEW_MARGIN_MS = 60_000;

async function requestToken(): Promise<string | null> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) return null;

  try {
    const res = await fetch(foundationHosts().oauth, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=content',
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data?.access_token) return null;
    const lifetime = Number.isFinite(data.expires_in) ? Number(data.expires_in) * 1000 : 3_600_000;
    token = { value: data.access_token, expiresAt: Date.now() + lifetime };
    return token.value;
  } catch {
    return null;
  }
}

/** The current token, refreshed when it is close to expiring. One request at a time. */
async function accessToken(): Promise<string | null> {
  if (token && token.expiresAt - RENEW_MARGIN_MS > Date.now()) return token.value;
  if (!pending) pending = requestToken().finally(() => { pending = null; });
  return pending;
}

export interface QuranFetchResult {
  res: Response | null;
  source: QuranApiSource;
}

/**
 * Fetches a v4 content path from whichever upstream is configured.
 *
 * `path` is everything after the version, starting with a slash --
 * `/verses/by_chapter/2?translations=131`. A Foundation request that cannot be
 * authorised falls back to the public API rather than failing: a missing
 * translation is recoverable, a studio that cannot load an ayah is not.
 */
export async function quranApiFetch(
  path: string,
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<QuranFetchResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (quranApiConfigured()) {
    const auth = await accessToken();
    if (auth) {
      try {
        const res = await fetch(`${foundationHosts().content}${path}`, {
          ...init,
          headers: { ...headers, 'x-auth-token': auth, 'x-client-id': clientId() }
        });
        // 401/403 means the credentials are wrong or the token was rejected;
        // anything else is a real answer about the content itself.
        if (res.ok || (res.status !== 401 && res.status !== 403)) {
          return { res, source: 'foundation' };
        }
        token = null;
      } catch {
        // Unreachable. Fall through to the open API.
      }
    }
  }

  try {
    const res = await fetch(`${PUBLIC_BASE}${path}`, { ...init, headers });
    return { res, source: 'public' };
  } catch {
    return { res: null, source: 'public' };
  }
}
