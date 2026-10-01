/** What the Projects list reads off a saved project row. */
export interface ProjectRow {
  id: string;
  title: string;
  surahNumber: number;
  surahNameArabic?: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
  reciterName?: string;
  audioFileName?: string | null;
  audioDuration?: string | number | null;
  aspectRatio?: string;
  updatedAt: string;
}

/**
 * Whether a saved clip matches a search, on what someone would remember it
 * by: its title, the surah in either language, the reciter, the file it was
 * made from, or a reference typed as "67:".
 */
export function matchesProject(row: ProjectRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.title, row.surahNameEnglish, row.surahNameArabic, row.reciterName, row.audioFileName, `${row.surahNumber}:${row.ayahStart}`]
    .some(field => typeof field === 'string' && field.toLowerCase().includes(q));
}

/**
 * The shapes a project has been rendered in, from the render records that
 * point back at it, each once and in the order first rendered.
 */
export function renderedShapes(exports: { projectId?: string | null; aspectRatio?: string }[], projectId: string): string[] {
  const shapes: string[] = [];
  for (const record of exports) {
    if (record.projectId === projectId && record.aspectRatio && !shapes.includes(record.aspectRatio)) shapes.push(record.aspectRatio);
  }
  return shapes;
}
