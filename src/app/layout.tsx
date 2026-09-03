import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { LocaleProvider } from '@/components/LocaleProvider';
import { LOCALE_COOKIE, dictionaryFor, directionFor, resolveLocale, type Locale } from '@/lib/i18n';

/**
 * The language for this request.
 *
 * Read on the server, before anything renders. The palette can be restored by
 * an inline script because it only swaps CSS variables and leaves the markup
 * identical; the language changes the text of every node, so deciding it on the
 * client would either mismatch hydration or paint English first for everyone
 * who chose Arabic.
 */
async function currentLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = dictionaryFor(await currentLocale());
  return {
    title: t.meta.title,
    description: t.meta.description
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await currentLocale();

  return (
    /* `suppressHydrationWarning` covers exactly one element, and this is the
       one that needs it: the inline script below rewrites `data-palette`
       before React hydrates, so the server's "nocturne" and the client's
       restored value legitimately differ.

       `lang` and `dir` do *not* need it -- they come from the cookie the server
       just read, so both sides already agree. */
    <html
      lang={locale}
      dir={directionFor(locale)}
      className="dark"
      data-palette="nocturne"
      suppressHydrationWarning
    >
      <head>
        {/* Restore the saved palette before first paint. Doing this in an
            effect would flash Nocturne for a frame on every load for anyone
            who picked something else. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=localStorage.getItem('qc-palette');if(p&&/^[a-z]+$/.test(p))document.documentElement.dataset.palette=p;}catch(e){}`
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* IBM Plex Sans Arabic is the interface face for `lang="ar"`. Plex has
            no Arabic coverage, so without it the Arabic UI falls through to
            whatever the system happens to have and stops matching the design.
            The Quran faces below it are for the canvas and are loaded for both
            languages. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Aref+Ruqaa:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Reem+Kufi:wght@400;600;700&family=Scheherazade+New:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink text-parchment font-sans antialiased selection:bg-gold/30 selection:text-parchment min-h-screen">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
