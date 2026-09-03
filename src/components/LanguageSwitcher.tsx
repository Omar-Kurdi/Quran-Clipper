'use client';

import React from 'react';
import { Languages } from 'lucide-react';
import { useLocale } from './LocaleProvider';
import { DICTIONARIES, LOCALES } from '@/lib/i18n';

/**
 * English / العربية.
 *
 * A toggle rather than a menu, because there are two languages and a menu for
 * two options is a click of ceremony around a decision already made. It sits
 * beside the palette switcher: both are "how the studio presents itself",
 * neither is part of the video being made.
 *
 * Each language names itself in its own script -- an Arabic reader looking for
 * Arabic should not have to recognise the word "Arabic" first.
 */
export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      role="radiogroup"
      aria-label={t.switchLanguage}
      title={t.switchLanguage}
      className="flex items-center gap-1 p-0.5 bg-slate-800 rounded-lg border border-slate-700"
    >
      <Languages className="w-3.5 h-3.5 text-gold ms-1.5 shrink-0" aria-hidden />
      {LOCALES.map(id => {
        const active = locale === id;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            // Always in its own language, so the label is legible to the person
            // who needs it regardless of which one is currently active.
            lang={id}
            onClick={() => setLocale(id)}
            className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              active ? 'bg-gold text-ink' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            {DICTIONARIES[id].languageShort}
            <span className="sr-only"> — {DICTIONARIES[id].languageName}</span>
          </button>
        );
      })}
    </div>
  );
};
