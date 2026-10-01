'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Dialog } from './Dialog';
import { useT } from './LocaleProvider';

const KBD = 'px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded text-xs font-mono';

/**
 * How a clip is made, in six steps, from the header's Help menu.
 *
 * It replaced a three-step tour that opened by itself on the first visit and
 * covered the very form it described. The studio now teaches by its own
 * shape -- the tabs are in working order, and the sample says what to do --
 * and this is here for whoever asks.
 */
export const HowItWorksDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const t = useT();
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      label={t.source.howItWorks}
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl"
    >
      <button
        onClick={onClose}
        aria-label={t.common.close}
        className="absolute top-4 end-4 w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800"
      >
        <X className="w-5 h-5" />
      </button>
      <h2 className="text-lg font-bold text-slate-100 mb-4 pe-10">{t.source.howItWorks}</h2>
      <ol className="list-decimal ps-5 text-slate-300 space-y-2 text-sm leading-relaxed">
        <li><strong className="text-slate-100">{t.source.step1Strong}</strong> {t.source.step1}</li>
        <li>{t.source.step2Before} <strong className="text-slate-100">{t.source.step2Button}</strong>. {t.source.step2After}</li>
        <li>
          {t.source.step3Before} <kbd className={KBD}>SPACE</kbd> {t.source.step3Middle} <kbd className={KBD}>B</kbd>{' '}
          {t.source.step3After}
        </li>
        <li><strong className="text-slate-100">{t.source.step4Strong}</strong> {t.source.step4}</li>
        <li>{t.source.step5}</li>
        <li>{t.source.step6Before} <strong className="text-slate-100">{t.source.step6Strong}</strong>{t.source.step6After}</li>
      </ol>
      <p className="mt-4 text-[13px] leading-relaxed text-slate-400">
        {t.source.howItWorksNoteBefore} <strong>{t.source.howItWorksNoteTimed}</strong>{' '}
        {t.source.howItWorksNoteMiddle} <strong>{t.source.howItWorksNoteUploaded}</strong>{' '}
        {t.source.howItWorksNoteEnd}
      </p>
    </Dialog>
  );
};
