import { afterEach, describe, it, expect, vi } from 'vitest';
import { alignerAudioUrl } from './alignerAudio';

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
