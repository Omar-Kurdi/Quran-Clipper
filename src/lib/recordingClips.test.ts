import { describe, it, expect } from 'vitest';
import {
  snapToAyahs, ayahList, ayahRangeWindow, ayahsHeld,
  ayahWindow, clipLabel, clipMadeAt, clipVerses, inPlayOrder, normalizeClips, windowClipProject, MIN_CLIP_SEC, type RecordingClip
} from './recordingClips';

const verse = (key: string, startTime: number, endTime: number) => ({ verseKey: key, startTime, endTime });

/** 2:1-4 in a 60-second recording, with pauses between them. */
const verses = [verse('2:1', 2, 6), verse('2:2', 7, 15), verse('2:3', 15.2, 30), verse('2:4', 33, 50)];

describe('inPlayOrder', () => {
  it('lists clips in the order they play', () => {
    const clips: RecordingClip[] = [{ id: 'b', start: 30, end: 50, style: null }, { id: 'a', start: 0, end: 20, style: null }];
    expect(inPlayOrder(clips).map(c => c.start)).toEqual([0, 30]);
  });
});

describe('clipVerses and clipLabel', () => {
  it('holds every caption heard inside the window, on the recording clock', () => {
    const held = clipVerses(verses, { start: 10, end: 31 });
    expect(held.map(v => v.verseKey)).toEqual(['2:2', '2:3']);
    expect(held[0].startTime).toBe(7);
  });

  it('names the ayahs a clip holds', () => {
    expect(clipLabel(verses, { start: 0, end: 31 })).toBe('2:1–3');
    expect(clipLabel(verses, { start: 33, end: 50 })).toBe('2:4');
  });

  it('names nothing for a clip with no captions', () => {
    expect(clipLabel(verses, { start: 51, end: 60 })).toBe('');
  });
});

describe('ayahWindow', () => {
  it('opens and closes in the pauses around the ayahs', () => {
    // 2:2 to 2:3: the pause before is 6-7, after is 30-33.
    expect(ayahWindow(verses, 1, 2, 60)).toEqual({ start: 6.5, end: 30.5 });
  });

  it('takes no more than half a second of a long pause', () => {
    expect(ayahWindow(verses, 3, 3, 60)).toEqual({ start: 32.5, end: 50.5 });
  });

  it('takes half of a short pause, never the ayah next door', () => {
    // 2:2 ends at 15 and 2:3 starts at 15.2.
    expect(ayahWindow(verses, 2, 2, 60)!.start).toBeCloseTo(15.1, 5);
  });

  it('treats the recording start as the pause before the first ayah', () => {
    expect(ayahWindow([verse('1:1', 0.2, 3)], 0, 0, 10)!.start).toBe(0.1);
  });

  it('takes the two ends in either order', () => {
    expect(ayahWindow(verses, 2, 1, 60)).toEqual(ayahWindow(verses, 1, 2, 60));
  });

  it('is nothing for captions that are not there', () => {
    expect(ayahWindow(verses, 0, 9, 60)).toBeNull();
  });
});

describe('ayahList', () => {
  it('lists each ayah once, in the order heard, leaving out the basmala', () => {
    const heard = [verse('basmala', 0, 2), verse('2:1', 2, 4), verse('2:2', 4, 6), verse('2:2', 6, 8)];
    expect(ayahList(heard)).toEqual([{ key: '2:1', first: 1, last: 1 }, { key: '2:2', first: 2, last: 3 }]);
  });

  it("runs an ayah to its repeat's last caption", () => {
    const heard = [verse('2:1', 0, 2), verse('2:2', 2, 4), verse('2:1', 4, 6)];
    expect(ayahList(heard)[0]).toEqual({ key: '2:1', first: 0, last: 2 });
  });
});

describe('ayahRangeWindow and ayahsHeld', () => {
  it('is the clip by ayahs from the first ayah to the last, either way round', () => {
    expect(ayahRangeWindow(verses, '2:2', '2:3', 60)).toEqual(ayahWindow(verses, 1, 2, 60));
    expect(ayahRangeWindow(verses, '2:3', '2:2', 60)).toEqual(ayahWindow(verses, 1, 2, 60));
  });

  it('is nothing for an ayah the recording does not have', () => {
    expect(ayahRangeWindow(verses, '2:2', '2:9', 60)).toBeNull();
  });

  it('reads back the first and last ayah of a stretch, which the pickers show', () => {
    expect(ayahsHeld(verses, ayahRangeWindow(verses, '2:2', '2:3', 60)!)).toEqual({ from: '2:2', to: '2:3' });
    expect(ayahsHeld(verses, { start: 51, end: 59 })).toBeNull();
  });
});

describe('snapToAyahs', () => {
  // 2:1 is two captions; 2:2 and 2:3 one each, with a pause between each.
  const verses = [
    { verseKey: '2:1', startTime: 1, endTime: 3 },
    { verseKey: '2:1', startTime: 3, endTime: 5 },
    { verseKey: '2:2', startTime: 6, endTime: 9 },
    { verseKey: '2:3', startTime: 10, endTime: 14 },
  ];

  it('widens a stretch to the whole ayahs it holds, opened and closed on the pauses', () => {
    // Drag from the middle of 2:1's second caption to the middle of 2:2.
    expect(snapToAyahs(verses, 3.8, 7.6, 20)).toEqual({ start: 0.5, end: 9.5 });
  });

  it('leaves out an ayah the drag only grazes', () => {
    expect(snapToAyahs(verses, 5.5, 10.5, 20)).toEqual({ start: 5.5, end: 9.5 });
  });

  it('takes the drag in either direction', () => {
    expect(snapToAyahs(verses, 14, 9.6, 20)).toEqual(snapToAyahs(verses, 9.6, 14, 20));
  });

  it('keeps the stretch as dragged when no caption is inside it', () => {
    expect(snapToAyahs(verses, 15, 18, 20)).toBeNull();
  });
});

describe('normalizeClips', () => {
  it('keeps clips as they were saved', () => {
    const clip = { id: 'a', start: 1, end: 9, style: { textColor: '#000' } };
    expect(normalizeClips([clip])).toEqual([clip]);
  });

  it('drops what is not a clip', () => {
    expect(normalizeClips([null, 'x', { id: 'a', start: 5, end: 5.5 }, { id: 'b', start: -1, end: 9 }, { start: 1, end: 9 }])).toEqual([]);
    expect(normalizeClips({ id: 'a' })).toEqual([]);
  });

  it('reads a style that is not an object as the shared look', () => {
    expect(normalizeClips([{ id: 'a', start: 1, end: 9, style: ['x'] }])[0].style).toBeNull();
  });
});

describe('clipMadeAt', () => {
  it('reads when a clip was made from its id', () => {
    // As the studio made them: `clip-<time in base 36>-<counter>`.
    const now = Date.now();
    expect(clipMadeAt(`clip-${now.toString(36)}-1`)).toBe(now);
    expect(clipMadeAt(`clip-${Date.UTC(2026, 10, 18, 6, 30).toString(36)}-3`)).toBe(Date.UTC(2026, 10, 18, 6, 30));
  });

  it('is null for an id not made with a time', () => {
    expect(clipMadeAt('c1')).toBeNull();
    expect(clipMadeAt('clip-zz-1')).toBeNull();
    expect(clipMadeAt(`clip-${(Date.now() + 10 * 86_400_000).toString(36)}-1`)).toBeNull();
  });
});

describe('windowClipProject', () => {
  const window = { id: 'clip-a', start: 10, end: 30 };

  it('finds the clip project made from that window', () => {
    const made = [{ windowOf: 'proj_x/clip-b', cut: null }, { windowOf: 'proj_x/clip-a', cut: { start: 500, end: 520 } }];
    expect(windowClipProject(made, 'proj_x', 0, window)).toBe(made[1]);
  });

  it("finds one cut from the same stretch, a copy's window, on the original's clock", () => {
    // The recording itself trimmed from 100 s: its window 10-30 is 110-130 of the original.
    const made = [{ windowOf: 'proj_copy/clip-a', cut: { start: 110, end: 130 } }];
    expect(windowClipProject(made, 'proj_x', 100, window)).toBe(made[0]);
    expect(windowClipProject(made, 'proj_x', 0, window)).toBeUndefined();
  });

  it('finds nothing for a window not made yet', () => {
    expect(windowClipProject([{ windowOf: 'proj_x/clip-b', cut: { start: 10, end: 31 } }], 'proj_x', 0, window)).toBeUndefined();
  });
});
