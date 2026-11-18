'use client';

import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useT } from './LocaleProvider';

/** A file picked from a folder, and that folder as the browser names it (`webkitRelativePath`). */
export interface FolderFile {
  file: File;
  folder: string;
}

/** The folder a file of a picked folder sits in, from the top of what was picked: `Alaa-Aqel` or `MP3/Abdulbasit`. */
export function folderOf(file: File): string {
  const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

/** The recordings of a picked folder, by name -- numbered surah files sort into surah order. */
export function folderRecordings(files: File[], accepts: (file: File) => boolean): FolderFile[] {
  return files
    .filter(accepts)
    .map(file => ({ file, folder: folderOf(file) }))
    .sort((a, b) => `${a.folder}/${a.file.name}`.localeCompare(`${b.folder}/${b.file.name}`, undefined, { numeric: true }));
}

/**
 * Choose a recording from a folder rather than a file: the one way a browser
 * says which folder a file is in. The folder is listed and nothing more is
 * read; the file picked goes the way an uploaded one does, its folder kept
 * with the project for Projects to show.
 */
export const FolderPicker: React.FC<{
  accepts: (file: File) => boolean;
  onPick: (picked: FolderFile) => void;
}> = ({ accepts, onPick }) => {
  const t = useT();
  const [listed, setListed] = useState<FolderFile[] | null>(null);
  const pickFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) setListed(folderRecordings(files, accepts));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="relative inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-slate-700 text-[13px] font-semibold text-slate-200 hover:border-amber-500/60 hover:text-amber-300 cursor-pointer focus-within:ring-2 focus-within:ring-amber-400">
        <FolderOpen className="w-4 h-4 text-amber-400" />
        {t.source.pickFolder}
        <input
          type="file"
          multiple
          // Not in React's types: set on the element, as every current browser reads it.
          ref={element => { element?.setAttribute('webkitdirectory', ''); }}
          onChange={pickFolder}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-describedby="folder-pick-help"
        />
      </label>
      <span id="folder-pick-help" className="text-[11px] leading-relaxed text-slate-400">{t.source.pickFolderHelp}</span>
      {listed && (
        listed.length === 0 ? (
          <p className="text-xs text-amber-200">{t.source.folderEmpty}</p>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60">
            <p className="px-2.5 pt-2 pb-1 text-[11px] text-slate-400">{t.source.folderListed(listed.length)}</p>
            <ul className="max-h-56 overflow-y-auto pb-1">
              {listed.map(({ file, folder }) => (
                <li key={`${folder}/${file.name}`}>
                  <button type="button" onClick={() => { setListed(null); onPick({ file, folder }); }}
                    className="w-full text-start px-2.5 py-1.5 text-xs hover:bg-slate-800/80 focus-visible:bg-slate-800 focus-visible:outline-none">
                    <span className="block truncate text-slate-100" dir="auto">{file.name}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-500" dir="auto">{folder}/</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
};
