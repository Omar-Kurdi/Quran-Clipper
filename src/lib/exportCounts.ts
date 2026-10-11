/**
 * Counting finished exports, for the owner's `/stats` page.
 *
 * A count and nothing more: each export adds the surah, the clip's length and
 * its shape, with the time. Nothing that tells one visitor from another is
 * kept -- see the privacy policy (`legalCopy.ts`), which says so.
 */

/** What one export adds, as the route stores it. */
export interface ExportCount {
  surah: number | null;
  durationSec: number;
  aspectRatio: string;
}

const ASPECT_RATIO = /^\d{1,2}:\d{1,2}$/;
/** Longer than any clip the studio makes: a whole recording is a few hours. */
const MAX_DURATION_SEC = 6 * 60 * 60;

/** The count a request asks to add, or null when it is not one the studio would send. */
export function exportCountFrom(body: unknown): ExportCount | null {
  if (!body || typeof body !== 'object') return null;
  const { surah, durationSec, aspectRatio } = body as Record<string, unknown>;
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_SEC) return null;
  if (typeof aspectRatio !== 'string' || !ASPECT_RATIO.test(aspectRatio)) return null;
  const chapter = Number(surah);
  return {
    surah: Number.isInteger(chapter) && chapter >= 1 && chapter <= 114 ? chapter : null,
    durationSec: Math.round(duration),
    aspectRatio,
  };
}

/** Most exports one address may count in `COUNT_WINDOW_MS`: more than anyone makes by hand. */
export const COUNT_LIMIT = 30;
export const COUNT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whether an address may count one more export now. Held in memory only, and
 * only for the window, so a script cannot run the count up while nothing about
 * who exported is ever stored.
 */
export function createCountLimiter(limit = COUNT_LIMIT, windowMs = COUNT_WINDOW_MS, now: () => number = Date.now) {
  const recent = new Map<string, number[]>();
  return (visitor: string | null): boolean => {
    const at = now();
    for (const [key, times] of recent) {
      const kept = times.filter(time => at - time < windowMs);
      if (kept.length) recent.set(key, kept);
      else recent.delete(key);
    }
    const key = visitor ?? 'unknown';
    const times = recent.get(key) ?? [];
    if (times.length >= limit) return false;
    recent.set(key, [...times, at]);
    return true;
  };
}

/** A stored count, as the stats page reads it. */
export interface CountedExport extends ExportCount {
  createdAt: Date;
}

export interface ExportStats {
  total: number;
  last7Days: number;
  last30Days: number;
  /** Total length of every export, in seconds. */
  totalSec: number;
  /** The last 30 days, oldest first, each `YYYY-MM-DD` (UTC) with its count, days with none included. */
  byDay: { day: string; count: number }[];
  /** Most exported first. */
  bySurah: { surah: number; count: number }[];
  byAspectRatio: { aspectRatio: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ranked<K>(counts: Map<K, number>): [K, number][] {
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** The counts summed up for the stats page. */
export function summariseExports(rows: CountedExport[], now: Date = new Date()): ExportStats {
  const at = now.getTime();
  const within = (days: number) => rows.filter(row => at - row.createdAt.getTime() < days * DAY_MS).length;
  const days = new Map<string, number>();
  for (let k = 29; k >= 0; k--) days.set(new Date(at - k * DAY_MS).toISOString().slice(0, 10), 0);
  const surahs = new Map<number, number>();
  const shapes = new Map<string, number>();
  for (const row of rows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    if (days.has(day)) days.set(day, days.get(day)! + 1);
    if (row.surah) surahs.set(row.surah, (surahs.get(row.surah) ?? 0) + 1);
    if (row.aspectRatio) shapes.set(row.aspectRatio, (shapes.get(row.aspectRatio) ?? 0) + 1);
  }
  return {
    total: rows.length,
    last7Days: within(7),
    last30Days: within(30),
    totalSec: rows.reduce((sum, row) => sum + row.durationSec, 0),
    byDay: [...days].map(([day, count]) => ({ day, count })),
    bySurah: ranked(surahs).map(([surah, count]) => ({ surah, count })),
    byAspectRatio: ranked(shapes).map(([aspectRatio, count]) => ({ aspectRatio, count })),
  };
}

/** The cookie that opens `/stats`, set from `?token=` as the studio's own is. */
export const STATS_COOKIE = 'stats_token';

/** Comparison that does not leak how much of the token was right. */
export function tokenMatches(supplied: string | undefined | null, expected: string | undefined): boolean {
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
