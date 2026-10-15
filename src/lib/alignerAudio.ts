import { qfPassageOf } from './qfRecitations';

/**
 * Where the aligner fetches the studio's audio proxy from.
 *
 * The browser builds the proxy's address from whatever origin it reached the
 * studio on, and the sidecar fetches over http from one origin only, its
 * `ALIGN_AUDIO_PROXY_ORIGIN` -- so a studio opened at any other address handed
 * it one it refused, and every built-in reciter failed to align there. The
 * proxy's path and query mean the same wherever it is served, so when the
 * studio is told that origin too, they are re-rooted on it. Untold, the
 * address is sent as it came, as it always was.
 */
export function alignerAudioUrl(audioUrl: string): string {
  const origin = (process.env.ALIGN_AUDIO_PROXY_ORIGIN || '').replace(/\/$/, '');
  if (!origin) return audioUrl;
  try {
    const url = new URL(audioUrl);
    return url.pathname === '/api/audio/ayahs' ? `${origin}${url.pathname}${url.search}` : audioUrl;
  } catch {
    return audioUrl;
  }
}

/**
 * Whether a public installation may hand this address to the sidecar.
 *
 * The sidecar's ffmpeg fetches whatever it is given -- another port on this
 * machine, a service on its network, a local file -- so on a server anyone can
 * reach, only one shape is let through: this app's own reciter passage
 * (`qfPassageUrl`), whose recording is already this server's. The path must be
 * this app's: the same path on another port is not it.
 */
export function publicAudioUrlAllowed(raw: string, appOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const origins = [appOrigin, process.env.ALIGN_AUDIO_PROXY_ORIGIN || ''].map(o => o.replace(/\/$/, '')).filter(Boolean);
  return origins.includes(url.origin) && qfPassageOf(url.href) !== null;
}
