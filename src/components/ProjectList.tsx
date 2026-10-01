'use client';

import React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useT, useLocale } from './LocaleProvider';
import type { ProjectRow } from '@/lib/projectSearch';
import { formatTime } from '@/lib/verseEdits';

const RATIO_BOX: Record<string, string> = {
  '9:16': 'w-7 h-12',
  '4:5': 'w-9 h-11',
  '1:1': 'w-11 h-11',
  '16:9': 'w-14 h-8'
};

const GRID = 'grid grid-cols-[3.5rem_minmax(0,1fr)_auto] md:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1.5fr)_4.5rem_3.5rem_minmax(0,1.2fr)_8rem_auto] gap-x-4 items-center';

/** The column headings, from `md` up; below that each row says what it is on its own. */
export const ProjectListHeader: React.FC = () => {
  const t = useT();
  return (
    <div role="row" className={`${GRID} hidden md:grid h-9 text-xs text-slate-400`}>
      <span role="columnheader"><span className="sr-only">{t.projects.colFrame}</span></span>
      <span role="columnheader">{t.projects.colPassage}</span>
      <span role="columnheader">{t.projects.colAudio}</span>
      <span role="columnheader">{t.projects.colLength}</span>
      <span role="columnheader">{t.projects.colFrame}</span>
      <span role="columnheader">{t.projects.colRendered}</span>
      <span role="columnheader">{t.projects.colEdited}</span>
      <span role="columnheader"><span className="sr-only">{t.projects.colActions}</span></span>
    </div>
  );
};

/**
 * One saved clip, with what it takes to recognise it: its shape, passage,
 * whose voice, how long, where it has been rendered for, and when it was last
 * touched.
 */
export const ProjectListRow: React.FC<{
  row: ProjectRow;
  rendered: string[];
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ row, rendered, deleting, onOpen, onDelete }) => {
  const t = useT();
  const { locale } = useLocale();
  const seconds = Number(row.audioDuration);
  return (
    <div role="row" className={`${GRID} py-3 border-t border-slate-800 text-[13px]`}>
      <span role="cell" className="flex items-center justify-center">
        <span
          aria-hidden="true"
          className={`${RATIO_BOX[row.aspectRatio ?? '9:16'] ?? RATIO_BOX['9:16']} rounded border border-slate-600 bg-slate-950 flex items-center justify-center font-quran text-[10px] text-parchment overflow-hidden`}
        >
          {row.surahNameArabic}
        </span>
      </span>
      <span role="cell" className="min-w-0">
        <span className="block font-semibold text-slate-100 truncate">{t.projects.passage(row.surahNameEnglish, row.surahNumber, row.ayahStart, row.ayahEnd)}</span>
        <span className="block text-xs text-slate-400 truncate">{row.title}</span>
      </span>
      <span role="cell" className="hidden md:block min-w-0 truncate text-slate-300">
        {row.audioFileName ? t.projects.yourRecording(row.audioFileName) : row.reciterName}
      </span>
      <span role="cell" className="hidden md:block font-mono text-slate-300" dir="ltr">{seconds > 0 ? formatTime(seconds) : '—'}</span>
      <span role="cell" className="hidden md:block font-mono text-slate-300" dir="ltr">{row.aspectRatio}</span>
      <span role="cell" className="hidden md:block min-w-0 truncate text-slate-300">
        {rendered.length ? rendered.join(', ') : <span className="text-slate-500">{t.projects.notRendered}</span>}
      </span>
      <span role="cell" className="hidden md:block text-slate-300">{new Date(row.updatedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>
      <span role="cell" className="flex items-center gap-1.5 justify-end">
        <button onClick={onOpen} className="h-9 px-3.5 rounded-lg border border-slate-700 text-slate-100 font-semibold hover:bg-amber-500 hover:text-slate-950 hover:border-amber-500 transition-colors">
          {t.projects.open}
        </button>
        {/* Not the inviting button beside it: a project is the only copy of an
            edit, and this is the one control here that cannot be undone. */}
        <button
          onClick={onDelete}
          disabled={deleting}
          title={t.projects.deleteTitle(row.title)}
          aria-label={t.projects.deleteAria(row.title)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </span>
    </div>
  );
};
