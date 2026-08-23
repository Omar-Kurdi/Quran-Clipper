import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quran Clip Helper - GPU Accelerated Quran Video Creator',
  description: 'Create Quran recitation videos locally in the browser: forced-aligned word timing, canvas rendering, and 60 FPS 1080p/4K WebM export.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Aref+Ruqaa:wght@400;700&family=Inter:wght@300;400;500;600;700;800&family=Noto+Naskh+Arabic:wght@400;600;700&family=Reem+Kufi:wght@400;600;700&family=Scheherazade+New:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-slate-950 text-slate-100 font-sans antialiased selection:bg-amber-500/30 selection:text-amber-200 min-h-screen">
        {children}
      </body>
    </html>
  );
}
