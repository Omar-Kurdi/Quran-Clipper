import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  title: 'Quran Clipper — recitation clips, captioned to the voice',
  description:
    'Make vertical Quran recitation videos with captions timed to the reciter: ten built-in reciters or your own recording, translations, and Shorts, Reels and TikTok sizes, rendered in your browser.',
};

export default function Home() {
  return <Landing />;
}
