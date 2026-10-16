/**
 * What a Content Sync answer means for the recitations on this machine -- the
 * decisions of `qf-reciters.mjs sync`, with no network or disk, so they can be
 * tested (src/lib/qfSyncPlan.test.ts).
 *
 * The Quran Foundation's Developer Terms let an app keep its content, audio
 * included, past a week only when it is "obtained and maintained through the
 * Content Sync APIs", synced again at least every seven days. A recitation is
 * resource `recitations:<id>`; its snapshot lists every ayah file
 * (`record_type: "audio_file"`) with its address, word timings and when it
 * last changed.
 */

/** The most the Foundation allows stored content to go without a sync. */
export const SYNC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A sync is started a day early, so a missed run or a slow one never lets content pass the seven days. */
export const SYNC_DUE_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

/** Whether a reciter last synced at `entry.syncedAt` must be synced again. */
export function syncDue(entry, now = Date.now()) {
  const at = Date.parse(entry?.syncedAt ?? '');
  return !Number.isFinite(at) || now - at >= SYNC_DUE_AFTER_MS;
}

/**
 * A path the API hands back (`next_page_url`, `snapshot_url`: "/api/v4/...")
 * as one under the content API's base, or null when it is not one.
 */
export function apiPath(url) {
  const match = /^(?:https:\/\/apis(?:-prelive)?\.quran\.foundation)?(?:\/content)?\/api\/v4(\/.*)$/.exec(String(url ?? ''));
  return match ? match[1] : null;
}

/**
 * What a run of mutations asks for: the recitation gone (its last
 * resource-level change a delete), or its snapshot fetched and compared with
 * what is on disk (any other change -- a create, an invalidation, an update,
 * a row). Nothing when there were no changes.
 */
export function mutationPlan(mutations) {
  const ordered = [...(mutations ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const resourceLevel = ordered.filter(m => String(m.type).startsWith('RESOURCE_'));
  const deleted = resourceLevel.at(-1)?.type === 'RESOURCE_DELETE';
  return { deleted, snapshot: !deleted && ordered.length > 0 };
}

/** QF's word timings as stored: [word number, start ms, end ms], numbers (some recitations send strings). */
export function normalSegments(segments) {
  return (segments ?? []).filter(s => Array.isArray(s) && s.length >= 4)
    .map(([, number, start, end]) => [Number(number), Number(start), Number(end)])
    .filter(segment => segment.every(Number.isFinite));
}

const ayahOf = record => Number(record.verse_number ?? String(record.verse_key ?? '').split(':')[1]);
const surahOf = record => Number(record.chapter_id ?? String(record.verse_key ?? '').split(':')[0]);

/** A snapshot's ayah files by surah. */
export function recordsBySurah(records) {
  const bySurah = new Map();
  for (const record of records ?? []) {
    if (record.record_type !== 'audio_file') continue;
    const surah = surahOf(record);
    if (!Number.isInteger(surah) || !Number.isInteger(ayahOf(record))) continue;
    bySurah.set(surah, [...(bySurah.get(surah) ?? []), record]);
  }
  return bySurah;
}

/**
 * Whether a chapter on disk no longer matches the snapshot's files for it: an
 * ayah added or gone, another address, other word timings, or a file changed
 * after this copy was made. A copy made before addresses and change times were
 * kept is dated by `downloadedAtMs`.
 */
export function chapterStale(chapter, records, downloadedAtMs) {
  const stored = new Map((chapter?.ayahs ?? []).map(ayah => [ayah.ayah, ayah]));
  if (!records?.length || records.length !== stored.size) return true;
  return records.some(record => {
    const ayah = stored.get(ayahOf(record));
    if (!ayah) return true;
    if (ayah.url && ayah.url !== record.url) return true;
    // Numbers on both sides: chapters downloaded before the script coerced them hold text ("380").
    const kept = (ayah.segments ?? []).map(segment => segment.map(Number));
    if (JSON.stringify(kept) !== JSON.stringify(normalSegments(record.segments))) return true;
    const changed = Date.parse(record.updated_at ?? '');
    const since = ayah.updatedAt ? Date.parse(ayah.updatedAt) : downloadedAtMs;
    return Number.isFinite(changed) && Number.isFinite(since) && changed > since;
  });
}

/** The chapter with each ayah's address and change time from the snapshot, for an exact comparison next time. */
export function withSources(chapter, records) {
  const byAyah = new Map(records.map(record => [ayahOf(record), record]));
  return {
    ...chapter,
    ayahs: chapter.ayahs.map(ayah => {
      const record = byAyah.get(ayah.ayah);
      return record ? { ...ayah, url: record.url, updatedAt: record.updated_at ?? null } : ayah;
    }),
  };
}
