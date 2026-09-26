/**
 * Where saved projects live: the server, or -- on a public installation -- the
 * visitor's own browser.
 *
 * A public studio has no accounts, so a project saved on its server would have
 * no owner: every visitor would list, open and delete everyone else's. Kept in
 * the browser's IndexedDB, beside the audio a project already stores there,
 * each visitor has their own and nobody else's, and the server holds nothing.
 *
 * Both paths answer in the shape the studio already reads from `/api/projects`
 * -- `{ ok, status, json() }` for a save, the list of rows for a load -- so the
 * callers do not branch beyond choosing the mode.
 */

import { idbPut, idbAll, idbDelete } from './idb';
import { needsContentSync } from './contentSyncAge';
import { applyContentSync } from './contentSyncCore';
import { resolveArabicFont } from './quranData';
import type { StudioMode } from './studioMode';
import type { CorpusVerse } from './quranCorpus';
import type { VerseData } from './quranData';

type Row = Record<string, unknown> & { id: string; updatedAt: string; versesJson?: VerseData[] };

interface SaveAnswer {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** A stored row as far as listing needs: an object with an id and a time. */
function asRow(value: unknown): Row | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.updatedAt === 'string' ? (row as Row) : null;
}

const newId = () => `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
const asBlob = (row: Row) => new Blob([JSON.stringify(row)], { type: 'application/json' });

export async function saveProject(payload: Record<string, unknown>, mode: StudioMode): Promise<SaveAnswer> {
  if (mode !== 'public') {
    return fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  const now = new Date().toISOString();
  const row: Row = {
    ...payload,
    // A render saves under an id it chose, so its export can name the project.
    id: typeof payload.id === 'string' && payload.id ? payload.id : newId(),
    fontArabic: resolveArabicFont(payload.fontArabic as string | undefined),
    createdAt: now,
    updatedAt: now,
    // Just fetched, so as current as the upstream: see `refreshed`.
    syncedAt: now,
  };
  const stored = await idbPut('projects', row.id, asBlob(row));
  const body = stored
    ? { success: true, source: 'browser', project: row }
    : { success: false, error: 'This browser would not store the project (storage full or disabled).' };
  return { ok: stored, status: stored ? 200 : 507, json: async () => body };
}

export async function listProjects(mode: StudioMode): Promise<Row[] | null> {
  if (mode !== 'public') {
    const res = await fetch('/api/projects');
    if (!res.ok) return null;
    const data = await res.json();
    return data.projects || [];
  }
  const rows = (await Promise.all((await idbAll('projects')).map(blob => blob.text().then(
    text => { try { return asRow(JSON.parse(text)); } catch { return null; } }
  )))).filter((row): row is Row => row !== null);
  const current = await Promise.all(rows.map(refreshed));
  return current.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function deleteProject(id: string, mode: StudioMode): Promise<{ ok: boolean; status: number; error?: string }> {
  if (mode !== 'public') {
    const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    return { ok: res.ok && !!data?.success, status: res.status, error: data?.error };
  }
  await idbDelete('projects', id);
  return { ok: true, status: 200 };
}

/**
 * A stored project brought up to date with the Quran text it quotes.
 *
 * The same seven-day allowance the server keeps for its own rows (see
 * `contentSync`), applied to the browser's copy when it is listed. A check that
 * could not cover every ayah changes nothing and is tried again next time.
 */
async function refreshed(row: Row): Promise<Row> {
  const verses = Array.isArray(row.versesJson) ? row.versesJson : [];
  if (!verses.length || !needsContentSync(row.syncedAt as string | undefined)) return row;
  const translationIds = Array.isArray(row.translationIds) ? (row.translationIds as string[]) : [];
  // One range per surah, as the draft's check sends them. Worked out here
  // rather than with `contentSync.rangesOf`, which lives beside server code.
  const bySurah = new Map<number, number[]>();
  for (const verse of verses) {
    const [surah, ayah] = verse.verseKey.split(':').map(Number);
    if (Number.isFinite(surah) && Number.isFinite(ayah)) bySurah.set(surah, [...(bySurah.get(surah) || []), ayah]);
  }
  const ranges = [...bySurah].map(([surah, ayahs]) => `${surah}:${Math.min(...ayahs)}-${Math.max(...ayahs)}`);
  const keyed = [...new Set(verses.flatMap(verse => Object.keys(verse.translations || {})))];
  try {
    const res = await fetch(`/api/content/current?ranges=${ranges.join(',')}&ids=${keyed.join(',')}`);
    const sources = res.ok ? await res.json() : null;
    if (!sources?.success) return row;
    const result = applyContentSync({
      verses,
      translationIds,
      corpus: new Map((sources.corpus as CorpusVerse[]).map(verse => [verse.verseKey, verse])),
      texts: sources.texts,
      available: new Set(sources.available as string[]),
      defaultId: sources.defaultId,
    });
    if (!result.complete) return row;
    const next: Row = { ...row, versesJson: result.verses, translationIds: result.translationIds, syncedAt: new Date().toISOString() };
    await idbPut('projects', next.id, asBlob(next));
    return next;
  } catch {
    return row;
  }
}
