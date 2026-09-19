import { describe, it, expect } from 'vitest';
import { addBatchFiles, batchItems, batchResultFrom, nextBatchItem, updateBatchItem } from './batchMatch';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'audio/mpeg' });

describe('the batch list', () => {
  it('queues files in the order chosen', () => {
    const items = batchItems([file('a.mp3'), file('b.mp3')]);
    expect(items.map(item => [item.file.name, item.status])).toEqual([['a.mp3', 'waiting'], ['b.mp3', 'waiting']]);
    expect(nextBatchItem(items)?.file.name).toBe('a.mp3');
  });

  it('does not add the same recording twice', () => {
    const items = batchItems([file('a.mp3')]);
    const again = addBatchFiles(items, [file('a.mp3'), file('c.mp3')]);
    expect(again.map(item => item.file.name)).toEqual(['a.mp3', 'c.mp3']);
  });

  it('moves on once a file is done or has failed', () => {
    const [a, b] = batchItems([file('a.mp3'), file('b.mp3')]);
    const items = updateBatchItem([a, b], a.id, { status: 'failed', error: 'no helper' });
    expect(nextBatchItem(items)?.id).toBe(b.id);
  });
});

describe('batchResultFrom', () => {
  it('reads a successful match', () => {
    const result = batchResultFrom({
      success: true,
      verses: [{ verseKey: '2:255', startTime: 0, endTime: 5 }],
      surahNumber: 2,
      surahNameEnglish: 'Al-Baqarah',
      surahNameArabic: 'البقرة',
      ayahStart: 255,
      ayahEnd: 255,
      audioDuration: 42,
      timelineTitle: 'Al-Baqarah 2:255',
      warning: null
    });
    expect(result).toMatchObject({ surahNumber: 2, ayahStart: 255, audioDuration: 42, title: 'Al-Baqarah 2:255' });
  });

  it('refuses a failed or empty one', () => {
    expect(batchResultFrom({ success: false, error: 'x' })).toBeNull();
    expect(batchResultFrom({ success: true, verses: [] })).toBeNull();
    expect(batchResultFrom(null)).toBeNull();
  });
});
