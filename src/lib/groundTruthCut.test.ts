import { describe, it, expect } from 'vitest';
import { recordingUrl } from './groundTruthCut';

describe('recordingUrl', () => {
  it("unwraps the studio's proxy to the reciter's recording", () => {
    const proxied = '/api/audio/proxy?url=https%3A%2F%2Fdownload.quranicaudio.com%2Fquran%2Fx%2F001.mp3';
    expect(recordingUrl(proxied)?.href).toBe('https://download.quranicaudio.com/quran/x/001.mp3');
    expect(recordingUrl(`http://localhost:3000${proxied}`)?.hostname).toBe('download.quranicaudio.com');
  });

  it('refuses any host the proxy would not fetch, and anything not https', () => {
    expect(recordingUrl('https://example.com/a.mp3')).toBeNull();
    expect(recordingUrl('/api/audio/proxy?url=http%3A%2F%2F127.0.0.1%3A8000%2Fhealth')).toBeNull();
    expect(recordingUrl('http://download.quranicaudio.com/a.mp3')).toBeNull();
    expect(recordingUrl('not a url at all ::')).toBeNull();
  });
});
