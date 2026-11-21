/**
 * Saved projects as a library of recordings: each recording once, with every
 * clip made from it and which ayahs of its surah those clips already hold.
 *
 * An uploaded recording is one file -- its stored copy (`audioKey`) or, where
 * that is gone, its name -- so the projects saved from it are grouped as one.
 * A built-in reciter's surah is one recording too: each project saved from it
 * is a passage, listed as that recording's clip -- or, where the passage was
 * cut into clips of its own, those clips. Pure, so it can be tested.
 */

import { SURAHS_LIST } from './quranData';
import { clipMadeAt, clipVerses, inPlayOrder, normalizeClips, windowClipProject } from './recordingClips';

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
  /** What the uploaded file's own tag says, and the folder it was picked from (`audioTags.ts`). */
  audioTags?: { artist?: string; title?: string; track?: number; folder?: string; source?: string; clip?: true; windowOf?: string } | null;
  /** Where its audio was cut from in the original. */
  trimWindow?: { start: number; end: number } | null;
  audioDuration?: string | number | null;
  clips?: unknown;
  versesJson?: unknown;
  createdAt?: string;
  updatedAt: string;
}

/** A project or clip with a render on record: a clip id of '' is the project as a whole; when it was last rendered. */
export interface ExportedClip {
  projectId: string;
  clipId: string;
  exportedAt?: string | null;
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
  /** When it was last rendered, or null. */
  exportedAt: string | null;
  /** When it was made: a clip's own time (`clipMadeAt`), else its project's. */
  madeAt: string;
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
  /** Who recites an upload, as its file's tag names them; '' when it does not. */
  artist: string;
  /** The folder an upload was picked from, when it was picked by its folder; '' otherwise. */
  folder: string;
  duration: string | number | null;
  /** The project to open it with: the one last edited. */
  project: LibraryProject;
  projects: LibraryProject[];
  clips: LibraryClip[];
  /** For each ayah of the surah, from 1, the numbers of the clips holding it. */
  coverage: number[][];
  /** When its first project was made, and when any was last edited. */
  createdAt: string;
  updatedAt: string;
}

/**
 * One recording, one key: an upload's stored copy, or where there is none its
 * file name -- with its reciter, since every reciter's folder has its own
 * `049 - سورة الحجرات.mp3` and they are not one recording.
 */
const recordingKey = (project: LibraryProject) =>
  project.audioTags?.source
    ? `upload:source:${project.audioTags.source}`
    : project.audioKey
    ? `upload:${project.audioKey}`
    : project.audioFileName
      ? `upload:${project.audioTags?.artist ?? ''}/${project.audioFileName}`
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

/** A clip of a recording saved as a project of its own (`makeClipProject`), rather than a window on it. */
const isClipProject = (project: LibraryProject) => !!project.audioTags?.source && project.audioTags.clip === true;

/**
 * Whether one of the old layout's windows on `project` has been made a clip
 * project in `group` already: one made from it, or one cut from the same
 * stretch of the recording -- a copy of the project had the same windows.
 */
function madeProject(group: LibraryProject[], project: LibraryProject, clip: { id: string; start: number; end: number }) {
  const made = group.filter(isClipProject).map(other => ({ windowOf: other.audioTags?.windowOf, cut: other.trimWindow }));
  return !!windowClipProject(made, project.id, project.trimWindow?.start ?? 0, clip);
}

/** A recording's clips: each clip project, an upload's windows on it, or each reciter project as one. */
function clipsOf(kind: LibraryRecording['kind'], projects: LibraryProject[], exported: (projectId: string, clipId: string) => string | null | undefined) {
  const listed: Omit<LibraryClip, 'number'>[] = [];
  for (const project of projects) {
    // A reciter's passage is a clip of its surah, unless it was cut into clips of its own.
    if ((kind === 'reciter' && !normalizeClips(project.clips).length) || isClipProject(project)) {
      // A clip made from one of the old layout's windows keeps that window's render.
      const [windowProject, windowClip] = project.audioTags?.windowOf?.split('/') ?? [];
      const own = exported(project.id, '');
      const at = own === undefined && windowClip ? exported(windowProject, windowClip) : own;
      listed.push({ projectId: project.id, clipId: null, surahNumber: project.surahNumber, first: project.ayahStart, last: project.ayahEnd,
        exported: at !== undefined, exportedAt: at ?? null, madeAt: project.createdAt ?? project.updatedAt, updatedAt: project.updatedAt });
      continue;
    }
    const verses = asVerses(project.versesJson);
    for (const clip of inPlayOrder(normalizeClips(project.clips))) {
      if (madeProject(projects, project, clip)) continue;
      const ayahs = ayahsIn(verses, project.surahNumber, clip);
      const at = exported(project.id, clip.id);
      const made = clipMadeAt(clip.id);
      listed.push({ projectId: project.id, clipId: clip.id, surahNumber: project.surahNumber,
        first: ayahs.length ? Math.min(...ayahs) : 0, last: ayahs.length ? Math.max(...ayahs) : 0,
        exported: at !== undefined, exportedAt: at ?? null,
        madeAt: made !== null ? new Date(made).toISOString() : project.createdAt ?? project.updatedAt, updatedAt: project.updatedAt });
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
export function libraryOf(projects: LibraryProject[], done: ExportedClip[]) {
  const doneAt = new Map(done.map(row => [`${row.projectId}\u0000${row.clipId}`, row.exportedAt ?? null]));
  /** When it was last rendered; null when on record without a time, undefined when not rendered. */
  const exported = (projectId: string, clipId: string) => doneAt.get(`${projectId}\u0000${clipId}`);
  const groups = new Map<string, LibraryProject[]>();
  for (const project of [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const key = recordingKey(project);
    groups.set(key, [...(groups.get(key) ?? []), project]);
  }
  const recordings: LibraryRecording[] = [...groups].map(([key, group]) => {
    // Opened as the recording: the one that is not a clip of it, when there is one.
    const latest = group.find(project => !isClipProject(project)) ?? group[0];
    const kind = key.startsWith('upload:') ? 'upload' : 'reciter';
    const surah = SURAHS_LIST.find(each => each.number === latest.surahNumber);
    const clips = clipsOf(kind, group, exported);
    const coverage = Array.from({ length: surah?.numberOfAyahs ?? 0 }, (_, i) =>
      clips.filter(clip => clip.surahNumber === latest.surahNumber && clip.first <= i + 1 && i + 1 <= clip.last).map(clip => clip.number));
    return {
      key, kind, surahNumber: latest.surahNumber,
      surahNameEnglish: latest.surahNameEnglish, surahNameArabic: latest.surahNameArabic || surah?.nameArabic || '',
      source: (kind === 'upload' ? latest.audioFileName : latest.reciterName) || '',
      artist: kind === 'upload' ? group.find(project => project.audioTags?.artist)?.audioTags?.artist ?? '' : '',
      folder: kind === 'upload' ? group.find(project => project.audioTags?.folder)?.audioTags?.folder ?? '' : '',
      duration: latest.audioDuration ?? null, project: latest, projects: group, clips, coverage,
      createdAt: group.map(project => project.createdAt ?? project.updatedAt).sort()[0], updatedAt: group[0].updatedAt,
    };
  });
  const latestClips = recordings
    .flatMap(recording => recording.clips.map(clip => ({ ...clip, recording })))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.number - b.number);
  return { recordings, latestClips };
}

/**
 * The recording saved with `source` and the clip projects cut from it, in the
 * order they play: what the studio's tabs show. The recording is the one
 * last edited, where a copy of it was saved too; null when it is not saved.
 */
export function familyOf<P extends LibraryProject>(projects: P[], source: string): { recording: P | null; clips: P[] } {
  const same = [...projects].filter(project => project.audioTags?.source === source)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    recording: same.find(project => !isClipProject(project)) ?? null,
    clips: same.filter(isClipProject).sort((a, b) => (a.trimWindow?.start ?? 0) - (b.trimWindow?.start ?? 0) || a.id.localeCompare(b.id)),
  };
}

/** Rows as the projects list sends them, kept to those that are projects: anything else is left out. */
export function asLibraryProjects(rows: unknown[]): LibraryProject[] {
  return rows.filter((row): row is LibraryProject => {
    const r = row as Record<string, unknown> | null;
    return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.title === 'string'
      && typeof r.surahNumber === 'number' && typeof r.updatedAt === 'string';
  });
}

/** A clip's ayahs for its tab, as `3:14–15`; '' while it has no captions. */
export function clipTabLabel(clip: Pick<LibraryProject, 'surahNumber' | 'ayahStart' | 'ayahEnd' | 'versesJson'>): string {
  if (!Array.isArray(clip.versesJson) || !clip.versesJson.length) return '';
  return clip.ayahStart === clip.ayahEnd ? `${clip.surahNumber}:${clip.ayahStart}` : `${clip.surahNumber}:${clip.ayahStart}–${clip.ayahEnd}`;
}
