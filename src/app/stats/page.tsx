import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { STATS_COOKIE, summariseExports, tokenMatches, type ExportStats } from '@/lib/exportCounts';
import { SURAHS_LIST } from '@/lib/quranData';
import { readExportCounts } from '@/lib/exportCountStore';

export const metadata: Metadata = { title: 'Export stats — Quran-Clipper', robots: { index: false, follow: false } };

/**
 * How many videos this studio has exported: for its owner only.
 *
 * Opened once as `/stats?token=<STATS_TOKEN>` (the middleware swaps that for a
 * cookie); without the token, or with none set, the page does not exist.
 */
export default async function Stats() {
  const expected = process.env.STATS_TOKEN;
  if (!expected || !tokenMatches((await cookies()).get(STATS_COOKIE)?.value, expected)) notFound();

  let stats: ExportStats | null = null;
  let problem = '';
  try {
    stats = summariseExports(await readExportCounts());
  } catch (err: unknown) {
    problem = `The counts could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }

  return (
    <main className="stats">
      <style>{STYLE}</style>
      <h1>Exports</h1>
      <p className="note">Each finished export, counted with its surah, length and shape. Nothing says who made it, so this counts videos, not people.</p>
      {problem && <p>{problem}</p>}
      {stats && <Counts stats={stats} />}
    </main>
  );
}

const STYLE = `
  :root { --bg:#f7f7f5; --fg:#1c1c1a; --muted:#6b6b66; --line:#e2e2dd; --bar:#2f7d5b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141413; --fg:#ececea; --muted:#9a9a94; --line:#2c2c2a; --bar:#4fb487; } }
  body { background: var(--bg); color: var(--fg); }
  .stats { max-width: 760px; margin: 0 auto; padding: 32px 16px; font-family: system-ui, sans-serif; }
  .stats h1 { font-size: 22px; margin: 0 0 4px; }
  .stats p.note { color: var(--muted); margin: 0 0 24px; font-size: 14px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .tile { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .tile b { display: block; font-size: 28px; font-variant-numeric: tabular-nums; }
  .tile span { color: var(--muted); font-size: 13px; }
  .stats h2 { font-size: 15px; margin: 28px 0 10px; }
  .row { display: grid; grid-template-columns: 96px 1fr 40px; align-items: center; gap: 8px; font-size: 13px; padding: 2px 0; }
  .row .bar { height: 10px; background: var(--bar); border-radius: 2px; min-width: 1px; }
  .row .n { text-align: right; font-variant-numeric: tabular-nums; }
  .row .d { color: var(--muted); font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  td { border-bottom: 1px solid var(--line); padding: 6px 4px; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
      `;

const surahName = (surah: number) => SURAHS_LIST.find(s => s.number === surah)?.nameEnglish ?? `Surah ${surah}`;

function Counts({ stats }: { stats: ExportStats }) {
  const busiest = Math.max(1, ...stats.byDay.map(d => d.count));
  return (
    <>
      <div className="tiles">
        <div className="tile"><b>{stats.total}</b><span>all time</span></div>
        <div className="tile"><b>{stats.last7Days}</b><span>last 7 days</span></div>
        <div className="tile"><b>{stats.last30Days}</b><span>last 30 days</span></div>
        <div className="tile"><b>{Math.round(stats.totalSec / 60)}</b><span>minutes of video</span></div>
      </div>
      <h2>Last 30 days</h2>
      {stats.byDay.map(({ day, count }) => (
        <div className="row" key={day}>
          <span className="d">{day}</span>
          <div className="bar" style={{ width: `${(count / busiest) * 100}%`, opacity: count ? 1 : 0 }} />
          <span className="n">{count}</span>
        </div>
      ))}
      <h2>By surah</h2>
      <Ranked rows={stats.bySurah.slice(0, 20).map(({ surah, count }) => [`${surah}. ${surahName(surah)}`, count])} />
      <h2>By shape</h2>
      <Ranked rows={stats.byAspectRatio.map(({ aspectRatio, count }) => [aspectRatio, count])} />
    </>
  );
}

function Ranked({ rows }: { rows: [string, number][] }) {
  if (!rows.length) return <p className="note">None yet.</p>;
  return (
    <table><tbody>
      {rows.map(([label, count]) => <tr key={label}><td>{label}</td><td className="n">{count}</td></tr>)}
    </tbody></table>
  );
}
