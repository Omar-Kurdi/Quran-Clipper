import type { Metadata } from 'next';
import { LegalPage } from '@/components/landing/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of service — Quran Clipper',
  description: 'The terms for using the Quran Clipper studio.',
};

export default function Terms() {
  return <LegalPage document="terms" />;
}
