'use client';

import React, { useState } from 'react';
import { Languages } from 'lucide-react';
import { selectedOptions, knownTranslationName } from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { TranslationPicker } from './TranslationPicker';
import { useT } from './LocaleProvider';

/**
 * Which translations the card carries: a chip each and a way back into the
 * list. The list itself is a dialog -- 130 editions across 40 languages is not
 * a panel section -- and the catalogue is only fetched once it has been
 * opened, so a name it does not know yet falls back to the two this studio
 * ships defaults for, and then to the id, which is at least not a claim.
 *
 * In the Captions tab, right above the boxes it fills, because that is where
 * a caption's translation is read and corrected. It says it applies to every
 * caption, so it does not read as a setting of the one on screen.
 */
export const TranslationChooser: React.FC<{ value: string[]; onChange: (ids: string[]) => void }> = ({ value, onChange }) => {
  const t = useT();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { options: catalogue } = useTranslationCatalogue(isPickerOpen);
  const chosen = selectedOptions(value, catalogue);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Languages className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-slate-200">{t.translations.panelLabel}</span>
          <span className="block text-xs text-slate-400">{t.translations.everyCaption}</span>
        </span>
        <button
          onClick={() => setIsPickerOpen(true)}
          className="h-8 px-3 rounded-lg border border-slate-700 text-xs font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {t.translations.change}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((option, position) => (
          <span
            key={option.id}
            className="flex items-center gap-1.5 rounded-full bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200"
          >
            <span className="font-mono text-[11px] text-amber-400">{position + 1}</span>
            <span className="truncate max-w-44">{option.language ? option.name : knownTranslationName(option.id)}</span>
            {option.language && <span className="text-slate-500">· {option.language}</span>}
          </span>
        ))}
      </div>
      <TranslationPicker isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} value={value} onChange={onChange} />
    </div>
  );
};
