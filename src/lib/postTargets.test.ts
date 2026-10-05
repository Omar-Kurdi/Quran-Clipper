import { describe, it, expect } from 'vitest';
import { postTargets, renderedFor, postText, shareableFile, UPLOAD_PAGES, PLATFORM_FOR_PRESET } from './postTargets';
import { EXPORT_PRESETS } from './exportPresets';

describe('postTargets', () => {
  it('offers the platform the clip was rendered for first, then the rest', () => {
    expect(postTargets(['tiktok'])).toEqual(['tiktok', 'youtube', 'instagram', 'facebook']);
    expect(postTargets(['reels', 'shorts'])).toEqual(['instagram', 'youtube', 'tiktok', 'facebook']);
  });

  it('names each platform once, however many of its shapes were rendered', () => {
    expect(postTargets(['reels', 'ig-feed', 'ig-portrait'])).toEqual(['instagram', 'youtube', 'tiktok', 'facebook']);
  });

  it('knows a platform for every export preset', () => {
    for (const preset of EXPORT_PRESETS) expect(PLATFORM_FOR_PRESET[preset.id]).toBeDefined();
  });

  it('says which platforms the render was for', () => {
    expect(renderedFor('youtube', ['shorts'])).toBe(true);
    expect(renderedFor('tiktok', ['shorts'])).toBe(false);
  });

  it('links every platform to an https page of its own', () => {
    for (const url of Object.values(UPLOAD_PAGES)) expect(url).toMatch(/^https:\/\//);
  });
});

describe('postText', () => {
  it('is the title, a blank line, then the description', () => {
    expect(postText({ title: 'Surah Fatir 35:5-7', description: 'Recited by X\n\n#Quran' }))
      .toBe('Surah Fatir 35:5-7\n\nRecited by X\n\n#Quran');
  });
});

describe('shareableFile', () => {
  const blob = new Blob(['x'], { type: 'video/mp4' });

  it('is the file, named, where the browser can share it', () => {
    const file = shareableFile(blob, 'Fatir_35_5-7.mp4', () => true);
    expect(file?.name).toBe('Fatir_35_5-7.mp4');
    expect(file?.type).toBe('video/mp4');
  });

  it('is nothing where the browser cannot share files, or cannot say', () => {
    expect(shareableFile(blob, 'a.mp4', () => false)).toBeNull();
    expect(shareableFile(blob, 'a.mp4', undefined)).toBeNull();
    expect(shareableFile(blob, 'a.mp4', () => { throw new TypeError('no'); })).toBeNull();
  });

  it('types a file the encoder left untyped from its name', () => {
    expect(shareableFile(new Blob(['x']), 'a.webm', () => true)?.type).toBe('video/webm');
  });
});
