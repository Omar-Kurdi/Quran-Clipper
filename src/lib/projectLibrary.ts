/**
 * Saved projects as a library of recordings: each recording once, with every
 * clip made from it and which ayahs of its surah those clips already hold.
 *
 * An uploaded recording is one file -- its stored copy (`audioKey`) or, where
 * that is gone, its name -- so the projects saved from it are grouped as one.
 * A built-in reciter's surah is one recording too: each project saved from it
 * is a passage, listed as that recording's clip. Pure, so it can be tested.
 */

import { SURAHS_LIST } from './quranData';
import { clipVerses, inPlayOrder, normalizeClips } from './recordingClips';

export interface LibraryProject {
  id: string;
  title: string;
  surahNumber: number;
  surahNameEnglish: string;
  surahNameArabic?: string;
  ayahStart: number;
  ayahEnd: number;
  reciterId?: string;
  reciterName?: string;
  audioFileName?: string | null;
  audioKey?: string | null;
  audioDuration?: string | number | null;
  clips?: unknown;
  versesJson?: unknown;
  updatedAt: string;
}

export interface LibraryClip {
  projectId: string;
  /** The clip's id in its project, or null for a reciter's passage, which is the project itself. */
  clipId: string | null;
  /** Its number among the recording's clips, in the order they play. */
  number: number;
  surahNumber: number;
  /** First and last ayah it holds, or 0 when it holds none. */
  first: number;
  last: number;
  exported: boolean;
  updatedAt: string;
}

export interface LibraryRecording {
  key: string;
  kind: 'upload' | 'reciter';
  surahNumber: number;
  surahNameEnglish: string;
  surahNameArabic: string;
  /** The file's name for an upload, the reciter's for a built-in recording. */
  source: string;
  duration: string | number | null;
  /** The project to open it with: the one last edited. */
  project: LibraryProject;
  projects: LibraryProject[];
  clips: LibraryClip[];
  /** For each ayah of the surah, from 1, the numbers of the clips holding it. */
  coverage: number[][];
  updatedAt: string;
}

const recordingKey = (project: LibraryProject) =>
  project.audioKey || project.audioFileName
    ? `upload:${project.audioKey || project.audioFileName}`
    : `reciter:${project.reciterId ?? project.reciterName ?? ''}:${project.surahNumber}`;

/** The ayah numbers of this surah heard in a stretch of the recording. */
function ayahsIn(verses: { verseKey?: string; startTime: number; endTime: number }[], surah: number, clip: { start: number; end: number }) {
  return clipVerses(verses, clip)
    .map(verse => verse.verseKey?.split(':').map(Number))
    .filter((key): key is number[] => !!key && key[0] === surah && key[1] > 0)
    .map(key => key[1]);
}

const asVerses = (value: unknown) =>
  (Array.isArray(value) ? value : []).filter(
    (verse): verse is { verseKey?: string; startTime: number; endTime: number } =>
      !!verse && typeof verse === 'object' && typeof verse.startTime === 'number' && typeof verse.endTime === 'number'
  );

/** A recording's clips: an upload's own clips, or each reciter project as one. */
function clipsOf(kind: LibraryRecording['kind'], projects: LibraryProject[], exported: (projectId: string, clipId: string) => boolean) {
  const listed: Omit<LibraryClip, 'number'>[] = [];
  for (const project of projects) {
    if (kind === 'reciter') {
      listed.push({ projectId: project.id, clipId: null, surahNumber: project.surahNumber, first: project.ayahStart, last: project.ayahEnd,
        exported: exported(project.id, ''), updatedAt: project.updatedAt });
      continue;
    }
    const verses = asVerses(project.versesJson);
    for (const clip of inPlayOrder(normalizeClips(project.clips))) {
      const ayahs = ayahsIn(verses, project.surahNumber, clip);
      listed.push({ projectId: project.id, clipId: clip.id, surahNumber: project.surahNumber,
        first: ayahs.length ? Math.min(...ayahs) : 0, last: ayahs.length ? Math.max(...ayahs) : 0,
        exported: exported(project.id, clip.id), updatedAt: project.updatedAt });
    }
  }
  return listed
    .sort((a, b) => a.first - b.first || a.last - b.last)
    .map((clip, i) => ({ ...clip, number: i + 1 }));
}

/**
 * The library: recordings, last edited first, and the latest clips across all
 * of them. `done` is every project and clip with a render on record, a clip id
 * of '' meaning the project as a whole.
 */
export function libraryOf(projects: LibraryProject[], done: { projectId: string; clipId: string }[]) {
  const doneKeys = new Set(done.map(row => `${row.projectId}\u0000${row.clipId}`));
  const exported = (projectId: string, clipId: string) => doneKeys.has(`${projectId}\u0000${clipId}`);
  const groups = new Map<string, LibraryProject[]>();
  for (const project of [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const key = recordingKey(project);
    groups.set(key, [...(groups.get(key) ?? []), project]);
  }
  const recordings: LibraryRecording[] = [...groups].map(([key, group]) => {
    const latest = group[0];
    const kind = key.startsWith('upload:') ? 'upload' : 'reciter';
    const surah = SURAHS_LIST.find(each => each.number === latest.surahNumber);
    const clips = clipsOf(kind, group, exported);
    const coverage = Array.from({ length: surah?.numberOfAyahs ?? 0 }, (_, i) =>
      clips.filter(clip => clip.surahNumber === latest.surahNumber && clip.first <= i + 1 && i + 1 <= clip.last).map(clip => clip.number));
    return {
      key, kind, surahNumber: latest.surahNumber,
      surahNameEnglish: latest.surahNameEnglish, surahNameArabic: latest.surahNameArabic || surah?.nameArabic || '',
      source: (kind === 'upload' ? latest.audioFileName : latest.reciterName) || '',
      duration: latest.audioDuration ?? null, project: latest, projects: group, clips, coverage, updatedAt: latest.updatedAt,
    };
  });
  const latestClips = recordings
    .flatMap(recording => recording.clips.map(clip => ({ ...clip, recording })))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
  return { recordings, latestClips };
}
