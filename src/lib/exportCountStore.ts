import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CountedExport, ExportCount } from './exportCounts';

/**
 * Where the export counts are kept: one JSON line per export in
 * `data/export-counts.jsonl`, `QC_EXPORT_COUNTS_FILE` to move it. A file and
 * not the database because a public studio has none, and a public studio is
 * where the counting is for.
 */
const countsFile = () => process.env.QC_EXPORT_COUNTS_FILE || path.join(process.cwd(), 'data', 'export-counts.jsonl');

export async function addExportCount(count: ExportCount, at: Date = new Date()): Promise<void> {
  const file = countsFile();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify({ ...count, at: at.toISOString() }) + '\n');
}

/** Every count kept, oldest first; none when nothing has been counted yet. A line that does not read is skipped. */
export async function readExportCounts(): Promise<CountedExport[]> {
  const text = await readFile(countsFile(), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return '';
    throw err;
  });
  return text.split('\n').map(counted).filter((row): row is CountedExport => row !== null);
}

/** One line of the file, or null for a blank one or one cut short by a crash mid-write: the rest still count. */
function counted(line: string): CountedExport | null {
  if (!line.trim()) return null;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  const createdAt = new Date(String(row.at));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { surah: typeof row.surah === 'number' ? row.surah : null, durationSec: Number(row.durationSec) || 0, aspectRatio: String(row.aspectRatio ?? ''), createdAt };
}
