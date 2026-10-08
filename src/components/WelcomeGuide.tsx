'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useLocale } from './LocaleProvider';
import { GUIDE_STEPS, type GuideStep } from '@/lib/guideSteps';
import type { Locale } from '@/lib/i18n';

/**
 * The welcome guide: four cards, each a short clip of the studio and two
 * sentences, from picking a passage to exporting.
 *
 * Shown by itself once per language (`useWelcomeGuide`), and from the menu
 * whenever asked. A card dialog rather than the tour the redesign removed,
 * which pointed at the panel and covered the very form it described.
 */
export const WelcomeGuide: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t, locale } = useLocale();
  const [index, setIndex] = useState(0);
  const close = () => {
    onClose();
    setIndex(0);
  };
  const step = GUIDE_STEPS[index];
  const last = index === GUIDE_STEPS.length - 1;
  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      label={t.guide.label}
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
    >
      <button
        onClick={close}
        aria-label={t.common.close}
        className="absolute top-3 end-3 z-10 w-9 h-9 flex items-center justify-center text-slate-300 hover:text-slate-100 rounded-lg bg-slate-950/70 hover:bg-slate-800"
      >
        <X className="w-5 h-5" />
      </button>
      <GuideCard step={step} locale={locale} />
      <div className="px-5 pt-3 pb-5">
        <GuideDots count={GUIDE_STEPS.length} index={index} onSelect={setIndex} />
        <div className="mt-4 flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={close}>{t.guide.skip}</Button>
          <span className="flex-1" />
          {index > 0 && <Button size="md" onClick={() => setIndex(index - 1)}>{t.guide.back}</Button>}
          <Button variant="primary" size="md" onClick={() => (last ? close() : setIndex(index + 1))} autoFocus>
            {last ? t.guide.done : t.guide.next}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** One card: the clip, in the studio's own language, with a still where motion is turned down. */
const GuideCard: React.FC<{ step: GuideStep; locale: Locale }> = ({ step, locale }) => {
  const { t } = useLocale();
  const media = step.media[locale];
  return (
    <>
      <div className="aspect-[16/10] bg-slate-950 border-b border-slate-800">
        {media && (
          <picture>
            <source media="(prefers-reduced-motion: reduce)" srcSet={media.still.src} />
            <img src={media.animated.src} alt="" className="w-full h-full object-cover object-top" />
          </picture>
        )}
      </div>
      <div className="px-5 pt-4">
        <p className="text-xs font-semibold text-amber-400">{t.guide.welcome}</p>
        <h2 className="mt-1 text-lg font-bold text-slate-100">{t.guide[step.title]}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-300 min-h-[4.5rem]">{t.guide[step.body]}</p>
      </div>
    </>
  );
};

/** Where in the guide this is, and a way to any card. */
const GuideDots: React.FC<{ count: number; index: number; onSelect: (index: number) => void }> = ({ count, index, onSelect }) => {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-1.5" aria-label={t.guide.progress(index + 1, count)}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          aria-label={t.guide.goTo(i + 1)}
          aria-current={i === index ? 'step' : undefined}
          className="p-1.5 -m-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <span className={`block h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-amber-400' : 'w-1.5 bg-slate-600'}`} />
        </button>
      ))}
      <span className="ms-2 text-xs text-slate-400 tabular-nums">{t.guide.progress(index + 1, count)}</span>
    </div>
  );
};
