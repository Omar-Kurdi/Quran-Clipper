import type { Metadata } from 'next';
import { LegalPage } from '@/components/landing/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy policy — Quran-Clipper',
  description: 'What the Quran-Clipper studio does with your recordings, your projects and your YouTube access.',
};

export default function Privacy() {
  return <LegalPage document="privacy" />;
}
