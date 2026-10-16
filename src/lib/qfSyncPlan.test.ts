import { describe, it, expect } from 'vitest';
import {
  SYNC_MAX_AGE_MS, apiPath, chapterStale, mutationPlan, normalSegments, recordsBySurah, syncDue, withSources,
} from '../../scripts/qf-sync-plan.mjs';

type StoredChapter = Parameters<typeof withSources>[0];
type AudioRecord = Parameters<typeof withSources>[1][number];

const DAY = 24 * 60 * 60 * 1000;

// Al-Sudais's 1:1-2 as the Content Sync snapshot of recitations:3 lists them (2026-10-16).
const record = (ayah: number, overrides: Partial<AudioRecord> = {}): AudioRecord => ({
  record_type: 'audio_file', verse_key: `1:${ayah}`, verse_number: ayah, chapter_id: 1,
  url: `Sudais/mp3/00100${ayah}.mp3`, segments: [['0', '1', '380', '730'], ['1', '4', '740', '3082']],
  updated_at: '2017-02-20T17:50:32.122Z', ...overrides,
});
const stored = (ayah: number, extra: object = {}) => ({ ayah, file: `00100${ayah}.mp3`, ms: 3100, segments: [[1, 380, 730], [4, 740, 3082]], ...extra });
const chapter = (...ayahs: StoredChapter['ayahs']): StoredChapter => ({ qfId: 3, surah: 1, ayahs });
const downloaded = Date.parse('2026-10-15T12:00:00Z');

describe('when a sync is due', () => {
  it('is due when never synced, and a day before the seven days run out', () => {
    const now = Date.parse('2026-10-16T00:00:00Z');
    expect(syncDue(undefined, now)).toBe(true);
    expect(syncDue({ syncedAt: new Date(now - 5 * DAY).toISOString() }, now)).toBe(false);
    expect(syncDue({ syncedAt: new Date(now - 6 * DAY).toISOString() }, now)).toBe(true);
    expect(6 * DAY).toBeLessThan(SYNC_MAX_AGE_MS);
  });
});

describe("the API's own paths", () => {
  it('reads next_page_url and snapshot_url under the content base, and nothing else', () => {
    expect(apiPath('/api/v4/resources/snapshots/recitations/3')).toBe('/resources/snapshots/recitations/3');
    expect(apiPath('https://apis.quran.foundation/content/api/v4/resources/sync?cursor=x')).toBe('/resources/sync?cursor=x');
    expect(apiPath('https://example.com/api/v4/resources/sync')).toBeNull();
    expect(apiPath(null)).toBeNull();
  });
});

describe('what a run of mutations asks for', () => {
  it('nothing when nothing changed', () => {
    expect(mutationPlan([])).toEqual({ deleted: false, snapshot: false });
  });

  it('the snapshot for a create, an invalidation, an update or a row change', () => {
    for (const type of ['RESOURCE_CREATE', 'RESOURCE_INVALIDATE', 'RESOURCE_UPDATE', 'ROW_UPDATE', 'ROW_DELETE']) {
      expect(mutationPlan([{ type, sequence: 1 }])).toEqual({ deleted: false, snapshot: true });
    }
  });

  it('the recitation gone when its last resource-level change is a delete, whatever came before', () => {
    expect(mutationPlan([{ type: 'RESOURCE_CREATE', sequence: 1 }, { type: 'RESOURCE_DELETE', sequence: 2 }]))
      .toEqual({ deleted: true, snapshot: false });
    expect(mutationPlan([{ type: 'RESOURCE_CREATE', sequence: 3 }, { type: 'RESOURCE_DELETE', sequence: 2 }]))
      .toEqual({ deleted: false, snapshot: true });
  });
});

describe('a chapter on disk against the snapshot', () => {
  const records = [record(1), record(2)];

  it('matches when the files, timings and change times are the ones it was made from', () => {
    expect(chapterStale(chapter(stored(1), stored(2)), records, downloaded)).toBe(false);
  });

  it('matches a chapter that kept its word timings as text, as Al-Sudais\'s first download did', () => {
    const asText = (ayah: number) => ({ ...stored(ayah), segments: [['1', '380', '730'], ['4', '740', '3082']] });
    expect(chapterStale(chapter(asText(1), asText(2)), records, downloaded)).toBe(false);
  });

  it('is stale when an ayah was added or taken away', () => {
    expect(chapterStale(chapter(stored(1)), records, downloaded)).toBe(true);
    expect(chapterStale(chapter(stored(1), stored(2)), [record(1)], downloaded)).toBe(true);
    expect(chapterStale(chapter(stored(1), stored(2)), [], downloaded)).toBe(true);
  });

  it('is stale when the word timings or the address changed', () => {
    expect(chapterStale(chapter(stored(1), stored(2)), [record(1), record(2, { segments: [['0', '1', '400', '730']] })], downloaded)).toBe(true);
    expect(chapterStale(chapter(stored(1, { url: 'Sudais/mp3/001001.mp3' }), stored(2)), [record(1, { url: 'Sudais/v2/001001.mp3' }), record(2)], downloaded))
      .toBe(true);
  });

  it('is stale when a file changed after this copy was made, by its kept change time or else the download', () => {
    const later = record(2, { updated_at: '2026-10-20T00:00:00Z' });
    expect(chapterStale(chapter(stored(1), stored(2)), [record(1), later], downloaded)).toBe(true);
    expect(chapterStale(chapter(stored(1), stored(2, { updatedAt: '2026-10-21T00:00:00Z' })), [record(1), later], downloaded)).toBe(false);
  });
});

describe('the snapshot read by surah', () => {
  it('groups ayah files by surah and leaves out other records', () => {
    const grouped = recordsBySurah([record(1), record(2), record(1, { chapter_id: 2, verse_key: '2:1' }), { ...record(3), record_type: 'other' }]);
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)!.map(r => r.verse_key)).toEqual(['1:1', '1:2']);
  });
});

describe('a chapter given the snapshot sources', () => {
  it('keeps each ayah as it was, with its address and change time added', () => {
    const sourced = withSources(chapter(stored(1)), [record(1)]);
    expect(sourced.ayahs[0]).toEqual({ ...stored(1), url: 'Sudais/mp3/001001.mp3', updatedAt: '2017-02-20T17:50:32.122Z' });
    expect(normalSegments([['0', '1', '380', '730'], ['x']])).toEqual([[1, 380, 730]]);
  });
});
