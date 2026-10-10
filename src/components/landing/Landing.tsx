'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLocale } from '@/components/LocaleProvider';
import { RECITERS } from '@/lib/quranData';
import { HeroDemo } from './HeroDemo';
import { LANDING_COPY, type LandingCopy } from './landingCopy';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './landing.css';

const STUDIO = '/video-creator';

/**
 * The public front page: what the studio makes, shown running, then how, then
 * the way in. Everything links on to /video-creator; nothing here needs an
 * account or asks for anything.
 */
export function Landing() {
  const { locale } = useLocale();
  const copy = LANDING_COPY[locale];
  return (
    <div className="landing">
      <SiteHeader copy={copy} />
      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-text">
            <h1 id="lp-title">{copy.hero.title}</h1>
            <p>{copy.hero.body}</p>
            <Link className="lp-cta" href={STUDIO}>{copy.hero.open}</Link>
          </div>
          <HeroDemo copy={copy.hero} />
        </section>

        <Steps copy={copy} locale={locale} />

        <Reciters copy={copy} />
        <Facts copy={copy} />

        <section className="lp-closing" aria-labelledby="lp-closing-title">
          <h2 id="lp-closing-title">{copy.closing.title}</h2>
          <p>{copy.closing.body}</p>
          <Link className="lp-cta" href={STUDIO}>{copy.closing.open}</Link>
        </section>
      </main>
      <SiteFooter copy={copy} />
    </div>
  );
}

function Steps({ copy, locale }: { copy: LandingCopy; locale: string }) {
  return (
    <section className="lp-steps" aria-labelledby="lp-steps-title">
      <h2 id="lp-steps-title">{copy.steps.title}</h2>
      <p className="lp-lede">{copy.steps.intro}</p>
      <ol>
        {copy.steps.items.map(step => (
          <li key={step.video}>
            <div className="lp-step-text">
              <span className="lp-tab">{step.tab}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
            <StepVideo src={`/landing/${locale}/${step.video}`} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A recording of the studio doing the step, played while it is on screen and
 * held on its first frame for anyone who asked for less motion.
 */
function StepVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.4 });
    seen.observe(video);
    return () => seen.disconnect();
  }, []);
  return (
    <div className="lp-window">
      <video ref={ref} src={`${src}.mp4`} poster={`${src}.jpg`} muted loop playsInline preload="none" aria-hidden />
    </div>
  );
}

function Reciters({ copy }: { copy: LandingCopy }) {
  return (
    <section className="lp-reciters" aria-labelledby="lp-reciters-title">
      <h2 id="lp-reciters-title">{copy.reciters.title}</h2>
      <p className="lp-lede">{copy.reciters.body}</p>
      <ul>
        {RECITERS.filter(r => !r.hidden).map(r => (
          <li key={r.id}>
            <span className="ar" lang="ar" dir="rtl">{r.arabicName}</span>
            <span className="en" lang="en" dir="ltr">{r.name}</span>
          </li>
        ))}
        <li className="own"><span className="en">{copy.reciters.own}</span></li>
      </ul>
    </section>
  );
}

function Facts({ copy }: { copy: LandingCopy }) {
  return (
    <section className="lp-facts" aria-labelledby="lp-facts-title">
      <h2 id="lp-facts-title">{copy.facts.title}</h2>
      <dl>
        {copy.facts.items.map(item => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
