import { describe, it, expect } from 'vitest';
import {
  addClip, ayahWindow, clipLabel, clipStyle, clipVerses, dragClip, inPlayOrder, moveClip, newClip, normalizeClips, removeClip,
  settleLooks, styleDiff, switchOwnLook, MIN_CLIP_SEC, type RecordingClip
} from './recordingClips';

const verse = (key: string, startTime: number, endTime: number) => ({ verseKey: key, startTime, endTime });

/** 2:1-4 in a 60-second recording, with pauses between them. */
const verses = [verse('2:1', 2, 6), verse('2:2', 7, 15), verse('2:3', 15.2, 30), verse('2:4', 33, 50)];

describe('newClip', () => {
  it('keeps a clip inside the recording', () => {
    const clip = newClip(-3, 80, 60)!;
    expect([clip.start, clip.end]).toEqual([0, 60]);
    expect(clip.style).toBeNull();
  });

  it('takes the ends in either order', () => {
    const clip = newClip(20, 10, 60)!;
    expect([clip.start, clip.end]).toEqual([10, 20]);
  });

  it('is no clip when shorter than a clip can be', () => {
    expect(newClip(10, 10 + MIN_CLIP_SEC / 2, 60)).toBeNull();
  });
});

describe('addClip', () => {
  it('adds clips that overlap', () => {
    const clips = addClip(addClip([], newClip(0, 20, 60)), newClip(10, 30, 60));
    expect(clips).toHaveLength(2);
  });

  it('does not add the same stretch twice', () => {
    const once = addClip([], newClip(0, 20, 60));
    expect(addClip(once, newClip(0, 20, 60))).toBe(once);
  });
});

describe('moveClip and removeClip', () => {
  it('moves one clip and keeps its look', () => {
    const clip = { ...newClip(0, 20, 60)!, style: { textColor: '#fff' } };
    const [moved] = moveClip([clip], clip.id, 5, 25, 60);
    expect([moved.start, moved.end, moved.style]).toEqual([5, 25, { textColor: '#fff' }]);
  });

  it('leaves a clip where it is rather than make it too short', () => {
    const clips = [newClip(0, 20, 60)!];
    expect(moveClip(clips, clips[0].id, 5, 5.2, 60)).toBe(clips);
  });

  it('removes only the one named', () => {
    const clips = addClip(addClip([], newClip(0, 20, 60)), newClip(30, 50, 60));
    expect(removeClip(clips, clips[0].id).map(c => c.start)).toEqual([30]);
  });
});

describe('dragClip', () => {
  const clip = { start: 10, end: 30 };

  it('moves the whole bar and keeps its length, inside the recording', () => {
    expect(dragClip(clip, 'move', 5, 60)).toEqual({ start: 15, end: 35 });
    expect(dragClip(clip, 'move', -50, 60)).toEqual({ start: 0, end: 20 });
    expect(dragClip(clip, 'move', 100, 60)).toEqual({ start: 40, end: 60 });
  });

  it('moves one end, never past the other or out of the recording', () => {
    expect(dragClip(clip, 'start', -4, 60)).toEqual({ start: 6, end: 30 });
    expect(dragClip(clip, 'start', 40, 60)).toEqual({ start: 30 - MIN_CLIP_SEC, end: 30 });
    expect(dragClip(clip, 'end', 12.3456, 60)).toEqual({ start: 10, end: 42.346 });
    expect(dragClip(clip, 'end', -40, 60)).toEqual({ start: 10, end: 10 + MIN_CLIP_SEC });
    expect(dragClip(clip, 'end', 100, 60)).toEqual({ start: 10, end: 60 });
  });

  it('has no far end to keep to while the recording\'s length is unknown', () => {
    expect(dragClip(clip, 'end', 100, 0)).toEqual({ start: 10, end: 130 });
  });
});

describe('inPlayOrder', () => {
  it('lists clips in the order they play', () => {
    const clips = addClip(addClip([], newClip(30, 50, 60)), newClip(0, 20, 60));
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

describe('styleDiff and clipStyle', () => {
  const base = { textColor: '#fff', aspectRatio: '9:16', translationIds: ['20'] };

  it('keeps only what the clip changes', () => {
    const own = { ...base, textColor: '#000', translationIds: ['20'] };
    expect(styleDiff(own, base)).toEqual({ textColor: '#000' });
  });

  it('compares lists by what is in them', () => {
    expect(styleDiff({ ...base, translationIds: ['131'] }, base)).toEqual({ translationIds: ['131'] });
  });

  it('draws a clip with the shared look unless it has its own', () => {
    const clip = newClip(0, 20, 60)!;
    expect(clipStyle(base, clip)).toBe(base);
    expect(clipStyle(base, null)).toBe(base);
  });

  it('lets a change to the shared look reach what a clip did not change', () => {
    const clip: RecordingClip = { ...newClip(0, 20, 60)!, style: { textColor: '#000' } };
    expect(clipStyle({ ...base, aspectRatio: '1:1' }, clip)).toEqual({ ...base, aspectRatio: '1:1', textColor: '#000' });
  });
});

describe('settleLooks and switchOwnLook', () => {
  const shared = { textColor: '#fff', aspectRatio: '9:16' };
  const clip = (id: string, style: Record<string, unknown> | null = null): RecordingClip => ({ id, start: 0, end: 10, style });

  it('takes the config as the shared look while a clip with the shared look is open', () => {
    const clips = [clip('a'), clip('b', { textColor: '#000' })];
    const edited = { ...shared, aspectRatio: '1:1' };
    expect(settleLooks(edited, clips, 'a', null)).toEqual({ base: edited, clips });
  });

  it('keeps what the open clip with its own look changes, and the shared look as it was', () => {
    const clips = [clip('a', {}), clip('b')];
    const settled = settleLooks({ ...shared, textColor: '#000' }, clips, 'a', shared);
    expect(settled.base).toBe(shared);
    expect(settled.clips[0].style).toEqual({ textColor: '#000' });
    expect(settled.clips[1]).toBe(clips[1]);
  });

  it('gives the open clip its own look starting from the shared one', () => {
    const changed = switchOwnLook(true, shared, [clip('a')], 'a', null)!;
    expect(changed.clips[0].style).toEqual({});
    expect(changed.shared).toBe(shared);
    expect(changed.config).toBe(shared);
  });

  it('gives it the shared look back, dropping what it changed', () => {
    const changed = switchOwnLook(false, { ...shared, textColor: '#000' }, [clip('a', {})], 'a', shared)!;
    expect(changed.clips[0].style).toBeNull();
    expect(changed.shared).toBeNull();
    expect(changed.config).toBe(shared);
  });

  it('changes nothing with no clip open, or one already as asked', () => {
    expect(switchOwnLook(true, shared, [clip('a')], null, null)).toBeNull();
    expect(switchOwnLook(true, shared, [clip('a', {})], 'a', shared)).toBeNull();
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
