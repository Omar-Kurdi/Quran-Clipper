'use client';

import Link from 'next/link';
import { useLocale } from '@/components/LocaleProvider';
import type { LandingCopy } from './landingCopy';

const SOURCE = 'https://github.com/Omar-Kurdi/Quran-Clipper';

/** The public pages' header: the name home, the other language, and the way into the studio. */
export function SiteHeader({ copy }: { copy: LandingCopy }) {
  const { locale, setLocale } = useLocale();
  return (
    <header className="lp-top">
      <Link href="/" className="lp-wordmark">Quran Clipper</Link>
      <nav>
        <button
          type="button"
          className="lp-lang"
          lang={locale === 'en' ? 'ar' : 'en'}
          aria-label={copy.nav.languageLabel}
          onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
        >
          {copy.nav.language}
        </button>
        <Link className="lp-open" href="/video-creator">{copy.nav.open}</Link>
      </nav>
    </header>
  );
}

export function SiteFooter({ copy }: { copy: LandingCopy }) {
  return (
    <footer className="lp-footer">
      <span className="lp-wordmark">{copy.footer.rights}</span>
      <nav>
        <Link href="/privacy">{copy.footer.privacy}</Link>
        <Link href="/terms">{copy.footer.terms}</Link>
        <a href={SOURCE} rel="noopener">{copy.footer.source}</a>
      </nav>
    </footer>
  );
}
