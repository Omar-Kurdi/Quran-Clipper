import { describe, it, expect } from 'vitest';
import {
  captionLayers, parkedOnCaption, transitionWindow, leadingLayer, revealedWords, recitedWord,
  asCaptionTransition, TRANSITION_SECONDS, WORD_FADE_SECONDS, type CaptionMotion
} from './captionMotion';

const caption = (startTime: number, endTime: number, id = `${startTime}`) => ({ id, startTime, endTime });
// Two captions with a second's pause between them, and a third straight after.
const captions = [caption(0.5, 4), caption(5, 8), caption(8, 11)];
const motion = (transition: CaptionMotion['transition'], speed: CaptionMotion['speed'] = 'normal'): CaptionMotion =>
  ({ transition, words: 'none', speed });

describe('captionLayers at rest', () => {
  it('draws exactly what a cut always drew: the caption begun last, whole and still', () => {
    for (const time of [0, 0.5, 3.99, 4.7, 5, 7.99, 8, 20]) {
      const layers = captionLayers(captions, time, motion('cut'), 'show');
      const expected = [...captions].reverse().find(c => time >= c.startTime) ?? captions[0];
      expect(layers).toEqual([{ verse: expected, opacity: 1, translationOpacity: 1, dy: 0, scale: 1, blur: 0 }]);
    }
  });

  it('keeps each caller\'s moment before the first caption: the preview shows it, the export leaves the card empty', () => {
    expect(captionLayers(captions, 0, motion('cut'), 'show').map(l => l.verse)).toEqual([captions[0]]);
    expect(captionLayers(captions, 0, motion('cut'), 'hide')).toEqual([]);
    expect(captionLayers([], 1, motion('crossfade'), 'show')).toEqual([]);
  });
});

describe('captionLayers between two ayahs', () => {
  it('holds the last ayah through the pause and finishes the change as the next one begins', () => {
    const d = TRANSITION_SECONDS.normal;
    // Before the window: only the outgoing caption, untouched.
    expect(captionLayers(captions, 5 - d - 0.01, motion('crossfade'), 'show')).toHaveLength(1);
    // Half way: both, at equal strength.
    const middle = captionLayers(captions, 5 - d / 2, motion('crossfade'), 'show');
    expect(middle.map(l => l.verse)).toEqual([captions[0], captions[1]]);
    expect(middle[0].opacity).toBeCloseTo(0.5, 5);
    expect(middle[1].opacity).toBeCloseTo(0.5, 5);
    // From the next caption's start: that caption alone, fully in.
    expect(captionLayers(captions, 5, motion('crossfade'), 'show')).toEqual([
      { verse: captions[1], opacity: 1, translationOpacity: 1, dy: 0, scale: 1, blur: 0 },
    ]);
  });

  it('lets one ayah go before the next arrives, except in a cross-fade', () => {
    const d = TRANSITION_SECONDS.normal;
    for (const transition of ['fadeThrough', 'slide', 'zoom'] as const) {
      const middle = captionLayers(captions, 5 - d / 2, motion(transition), 'show');
      // Half way, the card is all but empty: one has gone, the other not yet come.
      for (const layer of middle) expect(layer.opacity).toBeLessThan(0.01);
      const visible = (time: number) =>
        captionLayers(captions, time, motion(transition), 'show').filter(layer => layer.opacity > 0).map(l => l.verse);
      expect(visible(5 - d * 0.8)).toEqual([captions[0]]);
      expect(visible(5 - d * 0.2)).toEqual([captions[1]]);
    }
  });

});

describe('captionLayers in motion', () => {
  it('moves a sliding ayah up and out, and the next up and in', () => {
    const d = TRANSITION_SECONDS.normal;
    const [out] = captionLayers(captions, 5 - d * 0.8, motion('slide'), 'show');
    expect(out.dy).toBeLessThan(0);
    const incoming = captionLayers(captions, 5 - d * 0.2, motion('slide'), 'show').find(l => l.verse === captions[1])!;
    expect(incoming.dy).toBeGreaterThan(0);
  });

  it('brings the translation in a little after the Arabic', () => {
    const d = TRANSITION_SECONDS.normal;
    const layers = captionLayers(captions, 5 - d * 0.3, motion('crossfade'), 'show');
    const incoming = layers[layers.length - 1];
    expect(incoming.verse).toBe(captions[1]);
    expect(incoming.translationOpacity).toBeLessThan(incoming.opacity);
  });

  it('runs its full length centred on a join with no pause, rather than turning into a cut', () => {
    // Linked captions are the usual case: published timings and the aligner
    // alike often end one exactly where the next begins.
    const [start, end] = transitionWindow(captions[1], captions[2], 'normal');
    expect(start).toBeCloseTo(8 - TRANSITION_SECONDS.normal / 2, 5);
    expect(end).toBeCloseTo(8 + TRANSITION_SECONDS.normal / 2, 5);
    expect(captionLayers(captions, 8, motion('crossfade'), 'show')).toHaveLength(2);
    expect(captionLayers(captions, end, motion('crossfade'), 'show').map(l => l.verse)).toEqual([captions[2]]);
  });

  it('shares what a short pause lacks equally either side of it', () => {
    const tight = [caption(0, 4), caption(4.2, 6)];
    const [start, end] = transitionWindow(tight[0], tight[1], 'slow');
    expect(end - start).toBeCloseTo(TRANSITION_SECONDS.slow, 5);
    expect(4 - start).toBeCloseTo(end - 4.2, 5);
  });

  it('never reaches before the outgoing caption began or after the incoming one ends', () => {
    const brief = [caption(3, 3.2), caption(3.2, 3.3)];
    const [start, end] = transitionWindow(brief[0], brief[1], 'slow');
    expect(start).toBe(3);
    expect(end).toBe(3.3);
  });
});

describe('captionLayers at the edges', () => {
  it('lets the first caption arrive on the empty card in an export', () => {
    const d = TRANSITION_SECONDS.normal;
    const [start, end] = transitionWindow(null, captions[0], 'normal');
    expect(end).toBe(0.5);
    const middle = (start + end) / 2;
    expect(captionLayers(captions, middle, motion('crossfade'), 'hide')[0].opacity).toBeCloseTo(0.5, 5);
    expect(captionLayers(captions, middle, motion('crossfade'), 'show')[0].opacity).toBe(1);
  });

  it('is a function of the time alone, so a frame painted twice is painted the same', () => {
    const at = 5 - TRANSITION_SECONDS.normal / 3;
    expect(captionLayers(captions, at, motion('zoom'), 'hide')).toEqual(captionLayers(captions, at, motion('zoom'), 'hide'));
  });
});

describe('leadingLayer', () => {
  it('follows whichever ayah the frame shows more of', () => {
    const d = TRANSITION_SECONDS.normal;
    expect(leadingLayer(captionLayers(captions, 5 - d * 0.9, motion('crossfade'), 'show'))?.verse).toBe(captions[0]);
    expect(leadingLayer(captionLayers(captions, 5 - d * 0.1, motion('crossfade'), 'show'))?.verse).toBe(captions[1]);
    expect(leadingLayer([])).toBeNull();
  });

  it('still names an ayah at the empty midpoint of a fade through, so the badge does not lose its surah', () => {
    const at = 5 - TRANSITION_SECONDS.normal / 2;
    for (const transition of ['fadeThrough', 'slide', 'zoom'] as const) {
      expect(leadingLayer(captionLayers(captions, at, motion(transition), 'show'))).not.toBeNull();
    }
  });
});

describe('asCaptionTransition', () => {
  it('reads anything it does not know as the cut', () => {
    expect(asCaptionTransition(undefined)).toBe('cut');
    expect(asCaptionTransition('spin')).toBe('cut');
    expect(asCaptionTransition('slide')).toBe('slide');
  });
});

describe('revealedWords', () => {
  it('shows each word from its own time, over a short fade', () => {
    const shown = revealedWords([1, 2, 3], 1, 2 + WORD_FADE_SECONDS / 2);
    expect(shown[0]).toBe(1);
    expect(shown[1]).toBeCloseTo(0.5, 5);
    expect(shown[2]).toBe(0);
  });

  it('brings a word with no time of its own in with the one before it, and a first one with the caption', () => {
    expect(revealedWords([undefined, 2, undefined], 1, 1.5)).toEqual([1, 0, 0]);
    expect(revealedWords([undefined, 2, undefined], 1, 3)).toEqual([1, 1, 1]);
  });
});

describe('recitedWord', () => {
  it('is the last word begun, and none before the first or after the caption ends', () => {
    expect(recitedWord([1, 2, 3], 4, 0.5)).toBe(-1);
    expect(recitedWord([1, 2, 3], 4, 2.5)).toBe(1);
    expect(recitedWord([1, undefined, 3], 4, 3.5)).toBe(2);
    expect(recitedWord([1, 2, 3], 4, 4)).toBe(-1);
  });
});

describe('captionLayers in soft focus', () => {
  it('blurs an ayah out of focus and brings the next into focus, sharp once each is fully shown', () => {
    const d = TRANSITION_SECONDS.normal;
    const early = captionLayers(captions, 5 - d * 0.8, motion('focus'), 'show');
    const late = captionLayers(captions, 5 - d * 0.2, motion('focus'), 'show');
    const outgoing = early.find(l => l.verse === captions[0])!;
    const incoming = late.find(l => l.verse === captions[1])!;
    expect(outgoing.blur).toBeGreaterThan(0);
    expect(incoming.blur).toBeGreaterThan(0);
    expect(outgoing.dy).toBe(0);
    expect(outgoing.scale).toBe(1);
    expect(captionLayers(captions, 2, motion('focus'), 'show')[0].blur).toBe(0);
    expect(captionLayers(captions, 6, motion('focus'), 'show')[0].blur).toBe(0);
    expect(captionLayers(captions, 5 - d * 0.8, motion('slide'), 'show').every(l => l.blur === 0)).toBe(true);
  });
});

describe('parkedOnCaption', () => {
  it('is true only on a caption\'s first moment, where selecting one puts the playhead', () => {
    expect(parkedOnCaption(captions, 5)).toBe(true);
    expect(parkedOnCaption(captions, 0.5)).toBe(true);
    expect(parkedOnCaption(captions, 5.2)).toBe(false);
    expect(parkedOnCaption(captions, 4.8)).toBe(false);
    expect(parkedOnCaption([], 5)).toBe(false);
  });
});
