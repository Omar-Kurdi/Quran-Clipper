import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

const memoryProjects: any[] = [];

async function getDbBindings() {
  if (!process.env.DATABASE_URL) return null;
  const [{ db }, { projects }] = await Promise.all([
    import('@/db'),
    import('@/db/schema')
  ]);
  return { db, projects };
}

export async function GET() {
  try {
    const bindings = await getDbBindings();
    if (!bindings) {
      return NextResponse.json({ success: true, source: 'memory', projects: memoryProjects.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 20) });
    }
    const list = await bindings.db.select().from(bindings.projects).orderBy(desc(bindings.projects.updatedAt)).limit(20);
    return NextResponse.json({ success: true, source: 'database', projects: list });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body.id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const projectData = {
      id,
      title: body.title || 'Untitled Quran Video',
      surahNumber: body.surahNumber || 1,
      surahNameArabic: body.surahNameArabic || 'الفاتحة',
      surahNameEnglish: body.surahNameEnglish || 'Al-Fatihah',
      ayahStart: body.ayahStart || 1,
      ayahEnd: body.ayahEnd || 7,
      reciterId: body.reciterId || 'sudais',
      reciterName: body.reciterName || 'Abdul Rahman Al-Sudais',
      audioUrl: body.audioUrl || 'https://server11.mp3quran.net/download/sds/001.mp3',
      audioDuration: body.audioDuration || '00:43',
      aspectRatio: body.aspectRatio || '9:16',
      fontArabic: body.fontArabic || 'Scheherazade New',
      fontTranslation: body.fontTranslation || 'Inter',
      arabicFontSize: body.arabicFontSize || 38,
      transliterationFontSize: body.transliterationFontSize || 24,
      translationFontSize: body.translationFontSize || 20,
      ayahNumberFontSize: body.ayahNumberFontSize || 34,
      textAlignment: body.textAlignment || 'center',
      textColor: body.textColor || '#ffffff',
      accentColor: body.accentColor || '#fbbf24',
      translationColor: body.translationColor || '#e2e8f0',
      textShadow: body.textShadow ?? true,
      showTransliteration: body.showTransliteration ?? true,
      showTranslation: body.showTranslation ?? true,
      showWaveform: body.showWaveform ?? true,
      showSurahBadge: body.showSurahBadge ?? true,
      surahBadgeText: body.surahBadgeText || '',
      surahBadgeSubtitleText: body.surahBadgeSubtitleText || '',
      bgType: body.bgType || 'video',
      bgUrl: body.bgUrl || 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
      bgOverlayOpacity: body.bgOverlayOpacity ?? 40,
      bgBlur: body.bgBlur ?? 0,
      cardBgOpacity: body.cardBgOpacity ?? 30,
      cardBorder: body.cardBorder ?? true,
      watermarkText: body.watermarkText || '@QuranClips',
      watermarkPosition: body.watermarkPosition || 'bottom-right',
      versesJson: body.versesJson || [],
      fps: body.fps || 60,
      gpuAccelerated: body.gpuAccelerated ?? true,
      createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
      updatedAt: new Date()
    };

    const bindings = await getDbBindings();
    if (!bindings) {
      const idx = memoryProjects.findIndex(p => p.id === id);
      if (idx >= 0) memoryProjects[idx] = { ...memoryProjects[idx], ...projectData, createdAt: memoryProjects[idx].createdAt };
      else memoryProjects.unshift(projectData);
      return NextResponse.json({ success: true, source: 'memory', project: projectData });
    }

    const existing = await bindings.db.select().from(bindings.projects).where(eq(bindings.projects.id, id));
    if (existing.length > 0) {
      await bindings.db.update(bindings.projects).set(projectData).where(eq(bindings.projects.id, id));
    } else {
      await bindings.db.insert(bindings.projects).values(projectData);
    }

    return NextResponse.json({ success: true, source: 'database', project: projectData });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
