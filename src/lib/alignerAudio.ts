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
    return url.pathname === '/api/audio/proxy' ? `${origin}${url.pathname}${url.search}` : audioUrl;
  } catch {
    return audioUrl;
  }
}
