/**
 * Google sign-in for one permission, through Google Identity Services.
 *
 * Where the server holds the OAuth client's secret, signing in happens once:
 * the pop-up hands over a one-time code, the server keeps a refresh token for
 * this browser, and every later upload gets its token from the server with no
 * pop-up at all (`youtubeVault`, `connect` and `vaultToken` below). Without the
 * secret it is the browser-only sign-in that follows.
 *
 * The token client opens Google's own pop-up and hands back an access token
 * for the scope asked for -- no client secret and no redirect. Google's tokens
 * last an hour, and the token is kept in this browser's storage until then, so
 * another upload within the hour, in this tab or a later one, asks nothing.
 * After that Google has to be asked again, which a page with no server-side
 * secret cannot avoid; but once the person has granted the permission, it is
 * asked with no prompt, so Google's window opens and closes by itself without
 * another account choice or consent screen.
 *
 * The script is loaded ahead of the click that needs it: the pop-up has to open
 * while that click is still being handled, and a browser blocks one opened
 * after an await on a network request.
 */

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string }): void }
interface CodeResponse { code?: string; error?: string; error_description?: string }
interface CodeClient { requestCode(): void }
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: 'popup';
    callback: (response: CodeResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): CodeClient;
}
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GoogleOAuth2 } } };

let loading: Promise<GoogleOAuth2 | null> | null = null;
const STORE_KEY = 'qc.google.token';
const GRANTED_KEY = 'qc.google.granted';

type Held = { token: string; until: number };

/** Storage can be refused (private windows, blocked site data): then the token lives only in this tab. */
function readStore(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
/** False when the browser refused it -- see readStore. */
function writeStore(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storedToken(): Held | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readStore(STORE_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { token, until } = parsed as Record<string, unknown>;
  return typeof token === 'string' && typeof until === 'number' ? { token, until } : null;
}

let held: Held | null = null;

/** Loads Google's script once; null when it cannot be (offline, blocked by an extension). */
export function loadGoogleSignIn(): Promise<GoogleOAuth2 | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  loading ??= new Promise(resolve => {
    const ready = () => resolve((window as GoogleWindow).google?.accounts?.oauth2 ?? null);
    if ((window as GoogleWindow).google?.accounts?.oauth2) return ready();
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(script);
  });
  return loading;
}

/** A token still good for another minute, if this tab already has one. */
export const heldToken = (): string | null => {
  held ??= typeof window === 'undefined' ? null : storedToken();
  return held && held.until - Date.now() > 60_000 ? held.token : null;
};

/** Forgets the token, after Google has refused it. */
export const forgetToken = () => {
  held = null;
  writeStore(STORE_KEY, null);
};

/**
 * Asks for a token for `scope`. Must be called from the click itself, with the
 * script already loaded -- see above. Rejects when the pop-up is closed or
 * consent is refused.
 */
export function requestToken(clientId: string, scope: string): Promise<string> {
  const oauth2 = (window as GoogleWindow).google?.accounts?.oauth2;
  if (!oauth2) return Promise.reject(new Error('Google sign-in is not loaded.'));
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: response => {
        if (!response.access_token) return reject(new Error(response.error_description || response.error || 'No token.'));
        held = { token: response.access_token, until: Date.now() + (response.expires_in ?? 3600) * 1000 };
        writeStore(STORE_KEY, JSON.stringify(held));
        writeStore(GRANTED_KEY, '1');
        resolve(response.access_token);
      },
      error_callback: error => reject(new Error(error.message || error.type || 'Sign-in was closed.'))
    });
    // Google's default asks for the account every time. Once it has been
    // granted here, an empty prompt reuses the signed-in account and consent.
    client.requestAccessToken(readStore(GRANTED_KEY) ? { prompt: '' } : undefined);
  });
}

/** Google's tokens, as the studio's server hands them over. */
export type ServerToken = { accessToken: string; expiresIn: number };
/** Whether this studio keeps the sign-in, and whether this browser has one kept; with a token when it has. */
export type VaultState = { configured: boolean; connected: boolean; expired?: boolean; token?: ServerToken };

const vaultPost = (path: string, body?: unknown) =>
  fetch(`/api/youtube/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quranclipper' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

/** Keeps a token the server handed over, as the browser-only sign-in keeps its own. */
function keep(token: ServerToken): string {
  held = { token: token.accessToken, until: Date.now() + token.expiresIn * 1000 };
  writeStore(STORE_KEY, JSON.stringify(held));
  return token.accessToken;
}

/** What the server holds for this browser, with a fresh token if it holds one. */
export async function vaultState(): Promise<VaultState> {
  try {
    const res = await vaultPost('token');
    const body = (await res.json()) as { configured?: boolean; connected?: boolean; expired?: boolean; accessToken?: string; expiresIn?: number };
    const token = body.accessToken ? { accessToken: body.accessToken, expiresIn: body.expiresIn ?? 3600 } : undefined;
    if (token) keep(token);
    return { configured: Boolean(body.configured), connected: Boolean(body.connected), expired: body.expired, token };
  } catch {
    return { configured: false, connected: false };
  }
}

/**
 * Signs in once, for good: Google's pop-up for a one-time code, which the
 * server trades for a refresh token kept on this browser. Must be called from
 * the click itself, like `requestToken`. Rejects with the server's reason --
 * `no-refresh` when Google, having been asked before, gave no lasting grant.
 */
export function connect(clientId: string, scope: string): Promise<string> {
  const oauth2 = (window as GoogleWindow).google?.accounts?.oauth2;
  if (!oauth2) return Promise.reject(new Error('Google sign-in is not loaded.'));
  return new Promise((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope,
      ux_mode: 'popup',
      callback: response => {
        if (!response.code) return reject(new Error(response.error_description || response.error || 'No code.'));
        vaultPost('connect', { code: response.code })
          .then(async res => {
            const body = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; error?: string };
            if (!res.ok || !body.accessToken) throw new Error(body.error || 'failed');
            resolve(keep({ accessToken: body.accessToken, expiresIn: body.expiresIn ?? 3600 }));
          })
          .catch(reject);
      },
      error_callback: error => reject(new Error(error.message || error.type || 'Sign-in was closed.'))
    });
    client.requestCode();
  });
}

/** Signs this browser out of YouTube: the grant revoked at Google, and nothing kept here. */
export async function disconnect(): Promise<void> {
  forgetToken();
  writeStore(GRANTED_KEY, null);
  await vaultPost('disconnect').catch(() => undefined);
}
