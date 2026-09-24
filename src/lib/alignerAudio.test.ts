import { afterEach, describe, it, expect, vi } from 'vitest';
import { alignerAudioUrl, publicAudioUrlAllowed } from './alignerAudio';

const proxied = '/api/audio/proxy?url=https%3A%2F%2Fdownload.quranicaudio.com%2Fquran%2Fx%2F012.mp3';

describe('alignerAudioUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('puts the studio’s proxy on the origin the sidecar was told, whatever address the browser used', () => {
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', 'http://localhost:3000/');
    expect(alignerAudioUrl(`https://studio.example.net${proxied}`)).toBe(`http://localhost:3000${proxied}`);
    expect(alignerAudioUrl(`http://localhost:44107${proxied}`)).toBe(`http://localhost:3000${proxied}`);
  });

  it('leaves anything else, and everything when no origin is set, as it came', () => {
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', 'http://localhost:3000');
    expect(alignerAudioUrl('https://download.quranicaudio.com/quran/x/012.mp3')).toBe('https://download.quranicaudio.com/quran/x/012.mp3');
    expect(alignerAudioUrl('')).toBe('');
    vi.stubEnv('ALIGN_AUDIO_PROXY_ORIGIN', '');
    expect(alignerAudioUrl(`https://studio.example.net${proxied}`)).toBe(`https://studio.example.net${proxied}`);
  });
});

describe('publicAudioUrlAllowed', () => {
  const reciterHost = (host: string) => host === 'download.quranicaudio.com';
  const app = 'https://studio.example';
  const allowed = (url: string) => publicAudioUrlAllowed(url, app, reciterHost);

  it('lets through a reciter CDN and this app\'s own proxy of one', () => {
    expect(allowed('https://download.quranicaudio.com/quran/x/001.mp3')).toBe(true);
    expect(allowed(`${app}/api/audio/proxy?url=${encodeURIComponent('https://download.quranicaudio.com/q/1.mp3')}`)).toBe(true);
  });

  it('refuses anything else the sidecar would otherwise fetch', () => {
    // Another port on the server (a squid proxy, say), a local file, plain
    // http, and the proxy path served from somewhere that is not this app.
    expect(allowed('http://127.0.0.1:3128/')).toBe(false);
    expect(allowed('file:///etc/passwd')).toBe(false);
    expect(allowed('http://download.quranicaudio.com/q/1.mp3')).toBe(false);
    expect(allowed(`http://127.0.0.1:3128/api/audio/proxy?url=${encodeURIComponent('https://download.quranicaudio.com/q/1.mp3')}`)).toBe(false);
    expect(allowed(`${app}/api/audio/proxy?url=${encodeURIComponent('http://127.0.0.1:5432/')}`)).toBe(false);
    expect(allowed('not a url')).toBe(false);
  });
});

describe('publicAudioUrlAllowed behind a reverse proxy', () => {
  const saved = process.env.ALIGN_AUDIO_PROXY_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALIGN_AUDIO_PROXY_ORIGIN;
    else process.env.ALIGN_AUDIO_PROXY_ORIGIN = saved;
  });

  it('accepts the studio\'s own proxy address once it is pointed at this machine', () => {
    // Behind Caddy the app sees http://127.0.0.1:3000, never the public
    // https origin the browser used -- so the proxy address is rewritten to
    // the local one first, and that is the origin the check trusts.
    process.env.ALIGN_AUDIO_PROXY_ORIGIN = 'http://127.0.0.1:3000';
    const inner = encodeURIComponent('https://download.quranicaudio.com/q/1.mp3');
    const sent = alignerAudioUrl(`https://studio.example.com/api/audio/proxy?url=${inner}`);
    const reciterHost = (host: string) => host === 'download.quranicaudio.com';
    expect(sent).toBe(`http://127.0.0.1:3000/api/audio/proxy?url=${inner}`);
    expect(publicAudioUrlAllowed(sent, 'http://127.0.0.1:3000', reciterHost)).toBe(true);
    expect(publicAudioUrlAllowed(sent, 'http://localhost:3000', reciterHost)).toBe(true);
  });
});
