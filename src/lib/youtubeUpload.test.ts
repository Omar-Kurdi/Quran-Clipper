import { describe, it, expect, vi, afterEach } from 'vitest';
import { startUpload, uploadFailure, videoResource, UploadError, studioLink } from './youtubeUpload';
import { TITLE_MAX, TAGS_MAX } from './publishMetadata';

const meta = { title: 'Surah Fatir 35:5-7', description: 'Recited by Sudais\n\n#Quran #Shorts', tags: ['quran', 'surah fatir'] };

describe('videoResource', () => {
  it('carries the caption and the privacy asked for, declared not made for kids', () => {
    const resource = videoResource(meta, 'unlisted');
    expect(resource.snippet).toMatchObject({ title: meta.title, description: meta.description, tags: meta.tags });
    expect(resource.status).toEqual({ privacyStatus: 'unlisted', selfDeclaredMadeForKids: false });
  });

  it('fits YouTube\'s limits, dropping whole tags rather than cutting one', () => {
    const tags = Array.from({ length: 80 }, (_, i) => `tag number ${i}`);
    const resource = videoResource({ ...meta, title: 'x'.repeat(150), tags }, 'private');
    expect(resource.snippet.title).toHaveLength(TITLE_MAX);
    expect(resource.snippet.tags.join(',').length).toBeLessThanOrEqual(TAGS_MAX);
    expect(tags).toEqual(expect.arrayContaining(resource.snippet.tags));
  });
});

describe('uploadFailure', () => {
  const body = (reason: string) => ({ error: { errors: [{ reason }] } });

  it('reads Google\'s reasons', () => {
    expect(uploadFailure(401, null)).toBe('signin');
    expect(uploadFailure(403, body('quotaExceeded'))).toBe('quota');
    expect(uploadFailure(400, body('uploadLimitExceeded'))).toBe('limit');
    expect(uploadFailure(403, body('youtubeSignupRequired'))).toBe('forbidden');
    expect(uploadFailure(0, null)).toBe('network');
    expect(uploadFailure(500, 'not json')).toBe('other');
  });
});

describe('startUpload', () => {
  afterEach(() => vi.unstubAllGlobals());
  const file = new Blob(['video'], { type: 'video/mp4' });

  it('describes the video and returns the upload address Google gives back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startUpload('tok', meta, 'private', file)).resolves.toBe('https://upload.example/session');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('uploadType=resumable');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': '5' });
    expect(JSON.parse(init.body).status.privacyStatus).toBe('private');
  });

  it('turns a refusal into a failure the panel can explain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 })
    ));
    await expect(startUpload('tok', meta, 'private', file)).rejects.toMatchObject({ failure: 'quota' });
  });

  it('calls a dropped connection a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await startUpload('tok', meta, 'private', file).catch(e => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.failure).toBe('network');
  });
});

describe('studioLink', () => {
  it('opens the video\'s edit page in YouTube Studio', () => {
    expect(studioLink('abc123')).toBe('https://studio.youtube.com/video/abc123/edit');
  });
});
