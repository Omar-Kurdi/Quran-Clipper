'use client';

import React, { useState } from 'react';
import { Languages } from 'lucide-react';
import { selectedOptions, knownTranslationName } from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { TranslationPicker } from './TranslationPicker';
import { Button } from './Button';
import { useT } from './LocaleProvider';

/**
 * Which translations the card carries: a chip each and a way back into the
 * list. The list itself is a dialog -- 130 editions across 40 languages is not
 * a panel section -- and the catalogue is only fetched once it has been
 * opened, so a name it does not know yet falls back to the two this studio
 * ships defaults for, and then to the id, which is at least not a claim.
 *
 * In Style rather than beside a caption: it is a setting for every caption,
 * and it sat at the top of the per-caption panel, above the caption itself.
 */
export const TranslationChooser: React.FC<{ value: string[]; onChange: (ids: string[]) => void }> = ({ value, onChange }) => {
  const t = useT();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { options: catalogue } = useTranslationCatalogue(isPickerOpen);
  const chosen = selectedOptions(value, catalogue);
  return (
    <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
      <label className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5 text-[13px]">
        <Languages className="w-3.5 h-3.5 text-amber-400" />
        <span>{t.translations.panelLabel}</span>
      </label>
      <p className="text-xs text-slate-400 mb-2">{t.translations.panelHelp}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {chosen.map((option, position) => (
          <span
            key={option.id}
            className="flex items-center gap-1.5 rounded-full bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200"
          >
            <span className="font-mono text-[11px] text-amber-400">{position + 1}</span>
            <span className="truncate max-w-44">{option.language ? option.name : knownTranslationName(option.id)}</span>
            {option.language && <span className="text-slate-500">· {option.language}</span>}
          </span>
        ))}
      </div>
      <Button icon={<Languages className="w-3.5 h-3.5" />} onClick={() => setIsPickerOpen(true)}>
        {t.translations.choose}
      </Button>
      <TranslationPicker isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} value={value} onChange={onChange} />
    </div>
  );
};
