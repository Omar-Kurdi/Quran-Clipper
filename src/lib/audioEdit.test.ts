import { describe, it, expect } from 'vitest';
import {
  NO_EDIT, decodeEdit, editedAddress, editedLength, encodeEdit, isEdited, keptSpans, normalizeEdit, retime, splitAddress, toEdited, toSource,
  toTheEnd, trimmedTo, uploadEditAddress,
  type AudioEdit,
} from './audioEdit';
import {
  ayahSpans, fitToLength, keptPause, openingCut, pauseCuts, pauseKind, silencesWithin, silentSpans, voiceSpan, withAutoCuts, PAUSE_FLOOR,
} from './audioEditPlan';

const edit = (cuts: [number, number][], tempo = 1): AudioEdit => normalizeEdit({ cuts: cuts.map(([start, end]) => ({ start, end })), tempo });
const caption = (verseKey: string, startTime: number, endTime: number, words: number[] = []) =>
  ({ verseKey, startTime, endTime, words: words.map(timestamp => ({ timestamp })) });

describe('an edit as given', () => {
  it('sorts, joins and bounds its cuts, and keeps the speed within reach', () => {
    const made = normalizeEdit({ cuts: [{ start: 5, end: 6 }, { start: 1, end: 2.5 }, { start: 2, end: 3 }, { start: 9, end: 20 }], tempo: 3 }, 10);
    expect(made.cuts).toEqual([{ start: 1, end: 3 }, { start: 5, end: 6 }, { start: 9, end: 10 }]);
    expect(made.tempo).toBe(1.25);
  });

  it('drops what is not a cut: reversed, too short, not numbers', () => {
    const made = normalizeEdit({ cuts: [{ start: 3, end: 2 }, { start: 1, end: 1.01 }, { start: 'x', end: 4 }, null], tempo: 'fast' });
    expect(made).toEqual(NO_EDIT);
    expect(isEdited(made)).toBe(false);
  });

  it('keeps a cut automatic only while no hand cut overlaps it', () => {
    const made = normalizeEdit({ cuts: [{ start: 1, end: 2, auto: true }, { start: 1.5, end: 2.5 }, { start: 4, end: 5, auto: true }] });
    expect(made.cuts).toEqual([{ start: 1, end: 2.5 }, { start: 4, end: 5, auto: true }]);
  });

  it('travels in an address and comes back the same', () => {
    const made = normalizeEdit({ cuts: [{ start: 1.2345, end: 2, auto: true }, { start: 3, end: 4 }], tempo: 1.1, loudness: true });
    expect(decodeEdit(encodeEdit(made))).toEqual(made);
    expect(decodeEdit('not an edit')).toBeNull();
  });
});

describe('the edited clock', () => {
  const cut = edit([[2, 3], [5, 7]], 1.25);

  it('plays what is kept, faster', () => {
    expect(keptSpans(cut.cuts, 10)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 10 }]);
    expect(editedLength(cut, 10)).toBeCloseTo(7 / 1.25);
  });

  it('puts a moment inside a cut on its join', () => {
    expect(toEdited(1, cut)).toBeCloseTo(0.8);
    expect(toEdited(2.5, cut)).toBeCloseTo(1.6);
    expect(toEdited(4, cut)).toBeCloseTo(2.4);
    expect(toEdited(8, cut)).toBeCloseTo(4);
  });

  it('gives a join back as the end before the cut or the start after it', () => {
    expect(toSource(1.6, cut, 'end')).toBe(2);
    expect(toSource(1.6, cut, 'start')).toBe(3);
    expect(toSource(2.4, cut, 'start')).toBeCloseTo(4);
  });
});

describe('captions moved between edits', () => {
  const verses = [caption('1:1', 0.5, 2, [0.5, 1.2]), caption('1:2', 3, 6, [3, 4.5]), caption('1:3', 7, 9, [7])];

  it('come back where they were when the edit is taken back', () => {
    const cut = edit([[2, 3], [6, 7]], 1.2);
    const edited = retime(verses, NO_EDIT, cut);
    expect(edited[1].startTime).toBeCloseTo(edited[0].endTime);
    expect(retime(edited, cut, NO_EDIT)).toEqual(verses);
  });

  it('are left alone by the same edit', () => {
    expect(retime(verses, NO_EDIT, NO_EDIT)).toBe(verses);
  });

  it('go with the audio cut from under them', () => {
    const edited = retime(verses, NO_EDIT, edit([[2.5, 6.5]]));
    expect(edited.map(v => v.verseKey)).toEqual(['1:1', '1:3']);
  });

  it('follow a trim to the clip', () => {
    const trimmed = trimmedTo(NO_EDIT, { start: 0.3, end: 9.5 }, 12);
    expect(trimmed.cuts).toEqual([{ start: 0, end: 0.3 }, { start: 9.5, end: 12 }]);
    expect(retime(verses, NO_EDIT, trimmed)[0].startTime).toBeCloseTo(0.2);
  });
});

describe('silence in a recording', () => {
  it('are only true silence: a held note fading 9 dB under the voice is not one', () => {
    const rate = 1000;
    const samples = new Float32Array(10 * rate);
    const tone = (from: number, to: number, amplitude: number) => {
      for (let i = from * rate; i < to * rate; i++) samples[i] = Math.sin(i) * amplitude;
    };
    tone(0, 3, 0.5);
    tone(3, 4, 0.18); // a madd held softly, 9 dB down
    tone(4, 5, 0.0005); // the room, 60 dB down
    tone(5, 9, 0.5);
    tone(9, 10, 0.0005);
    expect(silentSpans([samples], rate)).toEqual([{ start: 4, end: 5 }, { start: 9, end: 10 }]);
  });

  it('are none on a recording whose hiss is near its voice', () => {
    const samples = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i) * (i % 2000 < 1000 ? 0.5 : 0.2));
    expect(silentSpans([samples], 1000)).toEqual([]);
  });

  it('are cut to a selection, for Shorten silence there', () => {
    expect(silencesWithin([{ start: 1, end: 3 }, { start: 5, end: 5.2 }], { start: 2, end: 5.5 })).toEqual([{ start: 2, end: 3 }]);
  });
});

describe('pauses shortened', () => {

  it('are an ayah end, a stop sign or a breath by the captions around them', () => {
    const verses = [caption('2:1', 0, 3), caption('2:1', 3.6, 6), caption('2:2', 7, 9)];
    expect(pauseKind({ start: 3.1, end: 3.5 }, verses)).toBe('stop');
    expect(pauseKind({ start: 6.1, end: 6.9 }, verses)).toBe('ayah');
    expect(pauseKind({ start: 1, end: 1.5 }, verses)).toBe('breath');
  });

  it('are a stop sign inside one caption by the word they follow', () => {
    // Al-Minshawi's Mujawwad 32:18, one caption, resting six seconds at «فَاسِقًا ۚ».
    const ayah = { verseKey: '32:18', startTime: 63.4, endTime: 89.3, words: [
      { arabic: 'كَانَ', timestamp: 73.9 }, { arabic: 'فَاسِقًا ۚ', timestamp: 75.3 }, { arabic: 'لَّا', timestamp: 83.3 },
    ] };
    expect(pauseKind({ start: 77.3, end: 83.4 }, [ayah])).toBe('stop');
    expect(pauseKind({ start: 74.2, end: 74.8 }, [ayah])).toBe('breath');
  });

  it('keep at least their floor, and a little more when long', () => {
    expect(keptPause(0.6, 'ayah')).toBe(0.6);
    expect(keptPause(1.7, 'ayah')).toBeCloseTo(PAUSE_FLOOR.ayah + 0.15);
    expect(keptPause(10, 'ayah')).toBeCloseTo(PAUSE_FLOOR.ayah + 0.3);
  });

  it('are cut from the middle, inside the captions only', () => {
    const verses = [caption('2:1', 0, 3), caption('2:2', 5, 9)];
    const cuts = pauseCuts([{ start: 3, end: 5 }, { start: 9.2, end: 11 }], verses);
    expect(cuts).toHaveLength(1);
    const kept = 2 - (cuts[0].end - cuts[0].start);
    expect(kept).toBeCloseTo(keptPause(2, 'ayah'));
    expect(cuts[0].start - 3).toBeGreaterThan(5 - cuts[0].end);
    expect(cuts[0].auto).toBe(true);
  });

  it('are taken back without the hand cuts', () => {
    const withBoth = normalizeEdit({ cuts: [{ start: 1, end: 2 }, { start: 4, end: 5, auto: true }] });
    expect(withAutoCuts(withBoth, [], 10).cuts).toEqual([{ start: 1, end: 2 }]);
  });
});

describe('fitting a length', () => {
  const verses = [caption('3:1', 0, 20), caption('3:2', 22, 42), caption('3:3', 44, 64)];
  const auto = pauseCuts([{ start: 20, end: 22 }, { start: 42, end: 44 }], verses);

  it('changes nothing when it already fits', () => {
    expect(fitToLength({ target: 70, duration: 64, edit: NO_EDIT, auto, verses })).toEqual({ edit: NO_EDIT, over: 0, drop: [] });
  });

  it('shortens the pauses first, and only then speeds up, by the least that fits', () => {
    const shortened = fitToLength({ target: 62, duration: 64, edit: NO_EDIT, auto, verses });
    expect(shortened.edit.tempo).toBe(1);
    expect(shortened.edit.cuts).toHaveLength(2);
    const faster = fitToLength({ target: 55, duration: 64, edit: NO_EDIT, auto, verses });
    expect(faster.edit.tempo).toBeGreaterThan(1);
    expect(editedLength(faster.edit, 64)).toBeLessThanOrEqual(55);
    expect(editedLength({ ...faster.edit, tempo: faster.edit.tempo - 0.01 }, 64)).toBeGreaterThan(55);
  });

  it('says how far over, and which ayahs would have to go, past the fastest speed', () => {
    const result = fitToLength({ target: 36, duration: 64, edit: NO_EDIT, auto, verses });
    expect(result.edit.tempo).toBe(1.25);
    expect(result.over).toBeGreaterThan(0);
    expect(result.drop).toEqual(['3:3']);
    expect(ayahSpans(verses)).toHaveLength(3);
  });
});

describe('the voice in a recording', () => {
  it('starts a little before the first sound and ends a second after the last', () => {
    const rate = 1000;
    const samples = new Float32Array(10 * rate);
    for (let i = 2 * rate; i < 7 * rate; i++) samples[i] = Math.sin(i) * 0.5;
    samples[500] = 1; // a click, too short to be the voice
    const span = voiceSpan(samples, rate)!;
    expect(span.start).toBeCloseTo(1.6, 1);
    expect(span.end).toBeCloseTo(8, 1);
  });
});

describe('the openings before the passage', () => {
  it('are cut up to just before the first word', () => {
    const verses = [caption('istiadha', 0.2, 3), caption('basmala', 3, 6), caption('1:2', 6, 9, [6.5])];
    expect(openingCut(verses)).toEqual({ start: 0, end: 6.1 });
    expect(openingCut([caption('1:2', 0, 3)])).toBeNull();
  });
});

describe('an edit in an address', () => {
  const made = normalizeEdit({ cuts: [{ start: 0, end: 1.2 }], tempo: 1.1 });

  it('plays a reciter passage edited, and reads back as the passage and its edit', () => {
    const passage = '/api/audio/ayahs?reciter=qf-8&surah=32&start=19&end=22';
    const address = editedAddress(passage, made)!;
    expect(address.startsWith('/api/audio/edited?reciter=qf-8&surah=32&start=19&end=22&edit=')).toBe(true);
    expect(splitAddress(address)).toEqual({ source: passage, edit: made });
  });

  it('is nothing for another recording, and leaves an unedited address as it is', () => {
    expect(editedAddress('blob:http://localhost/123', made)).toBeNull();
    expect(splitAddress('/api/audio/ayahs?reciter=qf-8&surah=1&start=1&end=7')).toEqual({ source: '/api/audio/ayahs?reciter=qf-8&surah=1&start=1&end=7', edit: null });
    expect(splitAddress(uploadEditAddress(made))).toEqual({ source: '', edit: made });
  });
});

describe('a loop-friendly ending', () => {
  const looped = normalizeEdit({ cuts: [{ start: 8, end: 10 }], loop: true });

  it('plays half a second longer, and travels in the address', () => {
    expect(editedLength(looped, 10)).toBeCloseTo(8.5);
    expect(decodeEdit(encodeEdit(looped))).toEqual(looped);
    expect(isEdited(normalizeEdit({ loop: true }))).toBe(true);
  });

  it('holds the last caption over its silence, and gives it back without it', () => {
    const verses = [caption('1:1', 0, 4), caption('1:2', 4, 7.6)];
    const held = toTheEnd(verses, looped, 8.5);
    expect(held[1].endTime).toBe(8.5);
    expect(toTheEnd(held, NO_EDIT, 8)[1].endTime).toBe(8);
    expect(toTheEnd(verses, NO_EDIT, 8)).toBe(verses);
  });
});
