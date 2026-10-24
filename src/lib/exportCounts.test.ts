import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { createCountLimiter, exportCountFrom, summariseExports, tokenMatches } from './exportCounts';
import { addExportCount, readExportCounts } from './exportCountStore';

describe('exportCountFrom', () => {
  it('keeps the surah, the length and the shape, and nothing else sent with them', () => {
    expect(exportCountFrom({ surah: 12, durationSec: 41.6, aspectRatio: '9:16', fileName: 'mine.mp4', ip: '1.2.3.4' }))
      .toEqual({ surah: 12, durationSec: 42, aspectRatio: '9:16' });
  });

  it('counts an export of an upload with no surah, and refuses what the studio would never send', () => {
    expect(exportCountFrom({ surah: 0, durationSec: 10, aspectRatio: '16:9' })).toEqual({ surah: null, durationSec: 10, aspectRatio: '16:9' });
    expect(exportCountFrom({ surah: 1, durationSec: -1, aspectRatio: '9:16' })).toBeNull();
    expect(exportCountFrom({ surah: 1, durationSec: 10, aspectRatio: '<script>' })).toBeNull();
    expect(exportCountFrom({ surah: 1, durationSec: 'x', aspectRatio: '9:16' })).toBeNull();
    expect(exportCountFrom(null)).toBeNull();
  });
});

describe('createCountLimiter', () => {
  it('stops one address running the count up, and forgets it after the window', () => {
    let now = 0;
    const mayCount = createCountLimiter(2, 1000, () => now);
    expect([mayCount('a'), mayCount('a'), mayCount('a'), mayCount('b')]).toEqual([true, true, false, true]);
    now = 1000;
    expect(mayCount('a')).toBe(true);
  });
});

describe('summariseExports', () => {
  it('totals all time, the last 7 and 30 days, each day, each surah and each shape', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
    const stats = summariseExports([
      { surah: 12, durationSec: 60, aspectRatio: '9:16', createdAt: at(0) },
      { surah: 12, durationSec: 30, aspectRatio: '16:9', createdAt: at(3) },
      { surah: 1, durationSec: 30, aspectRatio: '9:16', createdAt: at(10) },
      { surah: null, durationSec: 0, aspectRatio: '9:16', createdAt: at(40) },
    ], now);
    expect([stats.total, stats.last7Days, stats.last30Days, stats.totalSec]).toEqual([4, 2, 3, 120]);
    expect(stats.byDay).toHaveLength(30);
    expect(stats.byDay[29]).toEqual({ day: '2026-10-11', count: 1, surahs: [{ surah: 12, count: 1 }] });
    expect(stats.byDay[26]).toEqual({ day: '2026-10-08', count: 1, surahs: [{ surah: 12, count: 1 }] });
    expect(stats.byDay[0].surahs).toEqual([]);
    expect(stats.bySurah).toEqual([{ surah: 12, count: 2 }, { surah: 1, count: 1 }]);
    expect(stats.byAspectRatio).toEqual([{ aspectRatio: '9:16', count: 3 }, { aspectRatio: '16:9', count: 1 }]);
  });
});

describe('summariseExports, by day', () => {
  it("lists each day's surahs, most exported first", () => {
    const now = new Date('2026-10-21T18:00:00Z');
    const stats = summariseExports([12, 1, 12, 55, null].map(surah => ({ surah, durationSec: 30, aspectRatio: '9:16', createdAt: now })), now);
    expect(stats.byDay[29]).toEqual({ day: '2026-10-21', count: 5, surahs: [{ surah: 12, count: 2 }, { surah: 1, count: 1 }, { surah: 55, count: 1 }, { surah: null, count: 1 }] });
  });
});

describe('tokenMatches', () => {
  it('matches only the token set, and nothing when none is set', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches('abc', undefined)).toBe(false);
  });
});

describe('the counts file', () => {
  const saved = process.env.QC_EXPORT_COUNTS_FILE;
  afterEach(() => {
    if (saved === undefined) delete process.env.QC_EXPORT_COUNTS_FILE;
    else process.env.QC_EXPORT_COUNTS_FILE = saved;
  });

  it('reads back what was counted, none before anything is, and skips a line cut short', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'qc-counts-')), 'sub', 'counts.jsonl');
    process.env.QC_EXPORT_COUNTS_FILE = file;
    expect(await readExportCounts()).toEqual([]);
    await addExportCount({ surah: 12, durationSec: 40, aspectRatio: '9:16' }, new Date('2026-10-11T10:00:00Z'));
    writeFileSync(file, '{"surah": 1, "dura\n', { flag: 'a' });
    await addExportCount({ surah: null, durationSec: 5, aspectRatio: '1:1' }, new Date('2026-10-11T11:00:00Z'));
    expect(await readExportCounts()).toEqual([
      { surah: 12, durationSec: 40, aspectRatio: '9:16', createdAt: new Date('2026-10-11T10:00:00Z') },
      { surah: null, durationSec: 5, aspectRatio: '1:1', createdAt: new Date('2026-10-11T11:00:00Z') },
    ]);
  });
});
