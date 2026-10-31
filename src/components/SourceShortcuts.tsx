'use client';

import React, { useSyncExternalStore } from 'react';
import { Bookmark, BookmarkCheck, Star, X } from 'lucide-react';
import { useT } from './LocaleProvider';
import { SURAHS_LIST } from '@/lib/quranData';
import type { ListPreference } from '@/lib/uiPreference';
import {
  favouriteReciters, passageBookmarks, sameBookmark, toggled, toggledBookmark, type PassageBookmark,
} from '@/lib/sourceShortcuts';

const useList = <T,>(list: ListPreference<T>) => useSyncExternalStore(list.subscribe, list.get, list.getServerSnapshot);

/** The favourite reciters, read where the picker lists them. */
export const useFavouriteReciters = () => useList(favouriteReciters);

/** The star beside the reciter picker: the chosen reciter in or out of the favourites. */
export const FavouriteStar: React.FC<{ reciterId: string }> = ({ reciterId }) => {
  const t = useT();
  const favourites = useFavouriteReciters();
  const on = favourites.includes(reciterId);
  const label = on ? t.source.unfavouriteReciter : t.source.favouriteReciter;
  return (
    <button
      type="button"
      onClick={() => favouriteReciters.set(toggled(favourites, reciterId))}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="h-11 w-11 shrink-0 rounded-lg border border-slate-700 bg-slate-950 flex items-center justify-center hover:border-slate-500"
    >
      <Star className={`w-4 h-4 ${on ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} aria-hidden="true" />
    </button>
  );
};

function usePassageLabel() {
  const t = useT();
  return (bookmark: PassageBookmark) => {
    const surah = SURAHS_LIST.find(s => s.number === bookmark.surah);
    return t.source.passageLabel(surah?.nameEnglish ?? '', surah?.nameArabic ?? '', bookmark.surah, bookmark.start, bookmark.end);
  };
}

/**
 * The bookmark button for the passage chosen, and the passages bookmarked,
 * each one click from being chosen again.
 */
export const PassageBookmarks: React.FC<{ passage: PassageBookmark; onPick: (passage: PassageBookmark) => void }> = ({ passage, onPick }) => {
  const t = useT();
  const bookmarks = useList(passageBookmarks);
  const labelOf = usePassageLabel();
  const marked = bookmarks.some(bookmark => sameBookmark(bookmark, passage));
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => passageBookmarks.set(toggledBookmark(bookmarks, passage))}
        aria-pressed={marked}
        className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-amber-300"
      >
        {marked ? <BookmarkCheck className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> : <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />}
        {marked ? t.source.unbookmarkPassage : t.source.bookmarkPassage}
      </button>
      {bookmarks.length > 0 && (
        <div role="group" aria-label={t.source.bookmarksLabel} className="flex flex-wrap gap-1.5">
          {bookmarks.map(bookmark => {
            const label = labelOf(bookmark);
            const current = sameBookmark(bookmark, passage);
            return (
              <span
                key={`${bookmark.surah}:${bookmark.start}-${bookmark.end}`}
                className={`inline-flex items-center rounded-full border text-xs ${current ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-300'}`}
              >
                <button type="button" onClick={() => onPick(bookmark)} className="ps-2.5 pe-1 py-1 hover:text-amber-300">{label}</button>
                <button
                  type="button"
                  onClick={() => passageBookmarks.set(bookmarks.filter(other => !sameBookmark(other, bookmark)))}
                  aria-label={t.source.removeBookmark(label)}
                  title={t.source.removeBookmark(label)}
                  className="pe-2 ps-0.5 py-1 text-slate-500 hover:text-slate-200"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};
