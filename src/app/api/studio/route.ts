import { existsSync } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { FONTS_ARABIC } from '@/lib/quranData';
import { studioMode } from '@/lib/studioMode';

export const dynamic = 'force-dynamic';

/**
 * What this installation is and has, for the studio to shape itself around.
 *
 * `missingFonts` is read from the disk on every request rather than at build
 * time: the fonts are copied onto a server after it is built, and a build that
 * remembered their absence would keep the picker greyed out after they arrived.
 */
export async function GET() {
  const missingFonts = FONTS_ARABIC
    .filter(font => font.file && !existsSync(path.join(process.cwd(), 'public', font.file)))
    .map(font => font.id);
  return NextResponse.json({ mode: studioMode(), missingFonts });
}
