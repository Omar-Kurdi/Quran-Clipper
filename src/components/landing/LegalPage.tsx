'use client';

import React from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { LANDING_COPY } from './landingCopy';
import { PRIVACY, TERMS } from './legalCopy';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './landing.css';

/** Where questions go: the address set for this studio, else the project's issue tracker. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const ISSUES = 'https://github.com/Omar-Kurdi/Quran-Clipper/issues';

/** The privacy policy or the terms, in the reader's language. */
export function LegalPage({ document: which }: { document: 'privacy' | 'terms' }) {
  const { locale } = useLocale();
  const copy = LANDING_COPY[locale];
  const contact = CONTACT_EMAIL
    ? `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`
    : locale === 'ar' ? `[صفحة المشروع على GitHub](${ISSUES})` : `[the project’s page on GitHub](${ISSUES})`;
  const doc = (which === 'privacy' ? PRIVACY : TERMS)[locale];
  return (
    <div className="legal">
      <SiteHeader copy={copy} />
      <main className="legal-body">
        <h1>{doc.title}</h1>
        <p className="legal-updated">{doc.updated}</p>
        {doc.governs && <p className="legal-note">{doc.governs}</p>}
        {doc.intro.map((p, i) => <p key={i}><Linked text={p} contact={contact} /></p>)}
        {doc.sections.map(section => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((p, i) => <p key={i}><Linked text={p} contact={contact} /></p>)}
            {section.list && (
              <ul>{section.list.map((item, i) => <li key={i}><Linked text={item} contact={contact} /></li>)}</ul>
            )}
          </section>
        ))}
      </main>
      <SiteFooter copy={copy} />
    </div>
  );
}

/** Plain text with `[label](url)` links, `code` spans and where to write in place of `{contact}`. */
function Linked({ text, contact }: { text: string; contact: string }) {
  const parts = text.replace('{contact}', contact).split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const external = /^https?:/.test(link[2]);
          return <a key={i} href={link[2]} {...(external ? { rel: 'noopener' } : {})}>{link[1]}</a>;
        }
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i} dir="ltr">{part.slice(1, -1)}</code>;
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}
