import { describe, it, expect } from 'vitest';
import { studioMode, closedInPublicMode, publicPage } from './studioMode';

describe('studioMode', () => {
  it('is personal unless public is asked for', () => {
    expect(studioMode({})).toBe('personal');
    expect(studioMode({ STUDIO_MODE: 'personal' })).toBe('personal');
    expect(studioMode({ STUDIO_MODE: 'anything' })).toBe('personal');
  });

  it('reads public however it is written', () => {
    expect(studioMode({ STUDIO_MODE: 'public' })).toBe('public');
    expect(studioMode({ STUDIO_MODE: ' Public ' })).toBe('public');
  });
});

describe('closedInPublicMode', () => {
  it('closes the routes that would share one visitor\'s data with the next', () => {
    for (const path of ['/api/projects', '/api/exports', '/api/ground-truth', '/api/render', '/api/render/worker']) {
      expect(closedInPublicMode(path)).toBe(true);
    }
  });

  it('leaves everything a visitor needs open', () => {
    for (const path of ['/video-creator', '/api/audio/match', '/api/quran/verses', '/api/studio', '/api/health', '/api/projectsx']) {
      expect(closedInPublicMode(path)).toBe(false);
    }
  });
});

describe('publicPage', () => {
  it('opens the front page, the policy, the terms and the demo media to anyone', () => {
    for (const path of ['/', '/privacy', '/terms', '/landing/en/style.mp4']) expect(publicPage(path)).toBe(true);
  });

  it('keeps the studio and its data behind the token', () => {
    for (const path of ['/video-creator', '/api/projects', '/privacy/x', '/landingx', '/terms.json']) {
      expect(publicPage(path)).toBe(false);
    }
  });
});
