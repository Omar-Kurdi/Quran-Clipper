import { afterEach, describe, it, expect, vi } from 'vitest';
import { alignerAudioUrl, publicAudioUrlAllowed } from './alignerAudio';

const passage = '/api/audio/ayahs?reciter=qf-3&surah=12&start=46&end=47';

describe('alignerAudioUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('puts a reciter passage on the origin the sidecar was told, whatever address the browser used', () => {
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', 'http://localhost:3000/');
    expect(alignerAudioUrl(`https://studio.example.net${passage}`)).toBe(`http://localhost:3000${passage}`);
    expect(alignerAudioUrl(`http://localhost:44107${passage}`)).toBe(`http://localhost:3000${passage}`);
  });

  it('leaves anything else, and everything when no origin is set, as it came', () => {
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', 'http://localhost:3000');
    expect(alignerAudioUrl('https://download.quranicaudio.com/quran/x/012.mp3')).toBe('https://download.quranicaudio.com/quran/x/012.mp3');
    expect(alignerAudioUrl('')).toBe('');
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', '');
    expect(alignerAudioUrl(`https://studio.example.net${passage}`)).toBe(`https://studio.example.net${passage}`);
  });
});

describe('publicAudioUrlAllowed', () => {
  const app = 'https://studio.example';
  const allowed = (url: string) => publicAudioUrlAllowed(url, app);

  it("lets through this app's own reciter passages only", () => {
    expect(allowed(`${app}${passage}`)).toBe(true);
  });

  it('refuses anything else the sidecar would otherwise fetch', () => {
    // A CDN directly, another port on the server (a squid proxy, say), a local
    // file, the passage path served from somewhere that is not this app, and a
    // passage of a reciter the studio does not have.
    expect(allowed('https://download.quranicaudio.com/quran/x/001.mp3')).toBe(false);
    expect(allowed('http://127.0.0.1:3128/')).toBe(false);
    expect(allowed('file:///etc/passwd')).toBe(false);
    expect(allowed(`http://127.0.0.1:3128${passage}`)).toBe(false);
    expect(allowed(`${app}/api/audio/ayahs?reciter=nobody&surah=1&start=1&end=7`)).toBe(false);
    expect(allowed('not a url')).toBe(false);
  });
});

describe('publicAudioUrlAllowed behind a reverse proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the studio's own passage address once it is pointed at this machine", () => {
    // Behind Caddy the app sees http://127.0.0.1:3000, never the public
    // https origin the browser used -- so the address is rewritten to the
    // local one first, and that is the origin the check trusts.
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', 'http://127.0.0.1:3000');
    const sent = alignerAudioUrl(`https://studio.example.com${passage}`);
    expect(sent).toBe(`http://127.0.0.1:3000${passage}`);
    expect(publicAudioUrlAllowed(sent, 'http://127.0.0.1:3000')).toBe(true);
    expect(publicAudioUrlAllowed(sent, 'http://localhost:3000')).toBe(true);
  });
});
