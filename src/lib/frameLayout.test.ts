import { describe, it, expect } from 'vitest';
import { frameLayout, asFrameLayout, blockTop, textFits, FRAME_LAYOUTS } from './frameLayout';

const FRAMES = [[1080, 1920], [1080, 1080], [1080, 1350], [1920, 1080]];

describe('frameLayout', () => {
  it('keeps the card exactly where it was before layouts existed', () => {
    const card = frameLayout(undefined, 1080, 1920);
    expect(card.id).toBe('card');
    expect(card.text).toEqual({ x: 1080 * 0.08, y: 1920 * 0.23, width: 1080 * 0.84, height: 1920 * 0.52 });
    expect(card.badgeY).toBe(1920 * 0.12);
    expect(card.waveY).toBe(1920 * 0.88);
    expect(card.translation).toBeNull();
    expect(card.drawsCard).toBe(true);
  });

  it('reads anything unknown as the card', () => {
    expect(asFrameLayout('sideways')).toBe('card');
    expect(asFrameLayout(42)).toBe('card');
    expect(asFrameLayout('split')).toBe('split');
  });

  it('keeps every box on the frame, below the badge, at every aspect ratio', () => {
    for (const id of FRAME_LAYOUTS) {
      for (const [width, height] of FRAMES) {
        const layout = frameLayout(id, width, height);
        for (const box of [layout.text, layout.translation].filter(b => b !== null)) {
          expect(box.x, id).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, id).toBeLessThanOrEqual(width);
          expect(box.y, id).toBeGreaterThan(layout.badgeY);
          expect(box.y + box.height, id).toBeLessThanOrEqual(height);
        }
      }
    }
  });
});

describe('frameLayout, every layout', () => {
  it('keeps the waveform off the text', () => {
    for (const id of FRAME_LAYOUTS) {
      const layout = frameLayout(id, 1080, 1920);
      for (const box of [layout.text, layout.translation].filter(b => b !== null)) {
        const inside = layout.waveY > box.y && layout.waveY < box.y + box.height;
        expect(inside, id).toBe(false);
      }
    }
  });

  it('separates the translation only in the split layout', () => {
    for (const id of FRAME_LAYOUTS) {
      const layout = frameLayout(id, 1080, 1920);
      expect(layout.translation !== null, id).toBe(id === 'split');
    }
    const split = frameLayout('split', 1080, 1920);
    expect(split.translation!.y).toBeGreaterThan(split.text.y + split.text.height);
  });

  it('draws no card in the open layout', () => {
    expect(frameLayout('open', 1080, 1920).drawsCard).toBe(false);
  });
});

describe('blockTop', () => {
  const box = { x: 0, y: 100, width: 500, height: 400 };
  it('centres a block that fits', () => {
    expect(blockTop(box, 200, 40)).toBe(200);
  });
  it('never starts closer to the top than the padding', () => {
    expect(blockTop(box, 390, 40)).toBe(140);
  });
});

describe('textFits', () => {
  const padding = 40;
  it('fits one box against the whole stack, as the card always has', () => {
    const card = frameLayout('card', 1080, 1920);
    const room = card.text.height - padding * 2;
    expect(textFits(card, { arabic: room - 100, belowArabic: 50, translation: 50 }, padding)).toBe(true);
    expect(textFits(card, { arabic: room - 100, belowArabic: 50, translation: 51 }, padding)).toBe(false);
  });

  it('fits each half of a split against its own box', () => {
    const split = frameLayout('split', 1080, 1920);
    const arabicRoom = split.text.height - padding * 2;
    const translationRoom = split.translation!.height - padding * 2;
    // More text than one card of either size would hold, but each half fits.
    expect(textFits(split, { arabic: arabicRoom - 60, belowArabic: 60, translation: translationRoom }, padding)).toBe(true);
    expect(textFits(split, { arabic: 10, belowArabic: 60, translation: translationRoom + 1 }, padding)).toBe(false);
    expect(textFits(split, { arabic: arabicRoom, belowArabic: 60, translation: 10 }, padding)).toBe(false);
  });
});
