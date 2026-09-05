'use client';

import React, { useMemo, useState } from 'react';
import { Check, Languages, Search, X, Loader2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useT } from './LocaleProvider';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import {
  MAX_TRANSLATIONS, groupByLanguage, searchTranslations, selectedOptions, toggleTranslation
} from '@/lib/translations';

interface TranslationPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Chosen translations, by quran.com resource id, in the order they are drawn. */
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Which translations the video shows.
 *
 * A dialog rather than a panel section, for the reason the studio's columns are
 * already dense: this is a list of roughly 130 editions in 40-odd languages,
 * and it is opened when someone wants a different language and never again.
 * What stays in the panel is the answer -- two or three chips.
 *
 * Grouped by language and searchable, because the interesting case is not
 * "find English" but "which of the four Urdu translations is this". The
 * translator's name is the row; the language is the heading it sits under.
 */
export const TranslationPicker: React.FC<TranslationPickerProps> = ({ isOpen, onClose, value, onChange }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  // Fetched on first open and kept for the session -- not at startup, which
  // would be a request every visitor pays for and few of them use.
  const { options, loading, failed, source } = useTranslationCatalogue(isOpen);

  const groups = useMemo(() => groupByLanguage(searchTranslations(options, query)), [options, query]);
  const chosen = selectedOptions(value, options);
  const full = value.length >= MAX_TRANSLATIONS;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} label={t.translations.dialogLabel} panelClassName="max-w-xl w-full">
      <div className="w-[min(34rem,92vw)] max-h-[85vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="p-4 pb-3 border-b border-slate-800">
          <div className="flex items-start gap-3">
            <span className="p-2 bg-amber-500/15 text-amber-400 rounded-xl border border-amber-500/25 shrink-0">
              <Languages className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-slate-100">{t.translations.title}</h3>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                {t.translations.help(MAX_TRANSLATIONS)}
              </p>
            </div>
          </div>

          {/* What is on the card right now, in the order it is drawn. Removing
              one is the common edit, so it is here rather than hidden in the
              list below. */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <span className="text-[11px] text-slate-400">{t.translations.selected(value.length, MAX_TRANSLATIONS)}</span>
            {chosen.map((option, index) => (
              <span
                key={option.id}
                className="flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/40 ps-2 pe-1 py-0.5 text-[11px] text-amber-200"
              >
                <span className="font-mono text-[10px] text-amber-400/80">{index + 1}</span>
                <span className="truncate max-w-40">{option.name}</span>
                <button
                  onClick={() => onChange(toggleTranslation(value, option.id))}
                  disabled={value.length === 1}
                  aria-label={t.translations.remove(option.name)}
                  title={value.length === 1 ? t.translations.keepOne : t.translations.remove(option.name)}
                  className="p-0.5 rounded-full text-amber-300 hover:text-red-300 disabled:opacity-30"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="relative mt-3">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.translations.searchPlaceholder}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg ps-8 pe-3 py-2 text-xs text-slate-100"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-slate-400 p-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t.translations.loading}
            </p>
          )}
          {failed && (
            <p className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-2">
              {t.translations.failed}
            </p>
          )}
          {!loading && !failed && groups.length === 0 && (
            <p className="text-[11px] text-slate-400 p-2">{t.translations.noMatches(query)}</p>
          )}

          {groups.map(group => (
            <div key={group.language} className="mb-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 px-1 mb-1">
                {group.language}
              </h4>
              <div className="flex flex-col gap-1">
                {group.options.map(option => {
                  const active = value.includes(option.id);
                  // A full selection greys out what cannot be added, rather
                  // than accepting the click and silently ignoring it.
                  const blocked = !active && full;
                  return (
                    <button
                      key={option.id}
                      onClick={() => onChange(toggleTranslation(value, option.id))}
                      disabled={blocked}
                      title={blocked ? t.translations.atLimit(MAX_TRANSLATIONS) : undefined}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-start transition-colors ${
                        active
                          ? 'bg-amber-500/15 border-amber-500/50 text-slate-100'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                      } ${blocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                          active ? 'bg-amber-500 border-amber-400 text-slate-950' : 'border-slate-700'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                      </span>
                      <span className="flex-1 min-w-0 text-xs truncate">{option.name}</span>
                      {option.rtl && (
                        <span className="text-[10px] text-slate-500 shrink-0">{t.translations.rtlBadge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* The one absence worth explaining. The Clear Quran is on quran.com's
            own site but not in the open API's list, which reads as a missing
            translation rather than as a licensing boundary. */}
        {source === 'public' && !loading && (
          <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-800">
            {t.translations.publicListNote}
          </p>
        )}

        <div className="p-3 border-t border-slate-800 flex justify-end">
          <Button size="md" variant="primary" onClick={onClose}>{t.common.done}</Button>
        </div>
      </div>
    </Dialog>
  );
};
