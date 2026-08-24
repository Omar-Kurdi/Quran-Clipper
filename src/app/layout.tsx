import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quran Clip Helper — Quran Recitation Video Studio',
  description: 'Create Quran recitation videos locally in the browser: forced-aligned word timing, canvas rendering, and 60 FPS 1080p/4K WebM export.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* `suppressHydrationWarning` covers exactly one element, and this is the
       one that needs it: the inline script below rewrites `data-palette`
       before React hydrates, so the server's "nocturne" and the client's
       restored value legitimately differ. */
    <html lang="en" className="dark" data-palette="nocturne" suppressHydrationWarning>
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
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Aref+Ruqaa:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Reem+Kufi:wght@400;600;700&family=Scheherazade+New:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink text-parchment font-sans antialiased selection:bg-gold/30 selection:text-parchment min-h-screen">
        {children}
      </body>
    </html>
  );
}
