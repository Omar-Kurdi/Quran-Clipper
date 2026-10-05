/**
 * Google sign-in for one permission, through Google Identity Services.
 *
 * The token client opens Google's own pop-up and hands back an access token
 * for the scope asked for -- no client secret, no redirect, nothing stored.
 * The token is held in this module for the life of the tab, so a second upload
 * in the same sitting does not ask again, and it is gone when the tab closes.
 *
 * The script is loaded ahead of the click that needs it: the pop-up has to open
 * while that click is still being handled, and a browser blocks one opened
 * after an await on a network request.
 */

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string }): void }
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
}
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GoogleOAuth2 } } };

let loading: Promise<GoogleOAuth2 | null> | null = null;
let held: { token: string; until: number } | null = null;

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
export const heldToken = (): string | null => (held && held.until - Date.now() > 60_000 ? held.token : null);

/** Forgets the token, after Google has refused it. */
export const forgetToken = () => { held = null; };

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
        resolve(response.access_token);
      },
      error_callback: error => reject(new Error(error.message || error.type || 'Sign-in was closed.'))
    });
    client.requestAccessToken();
  });
}
