/**
 * The body of a save-project request.
 *
 * Built as a pure function rather than inline in the page, for the reason the
 * badge bug demonstrated: a payload assembled from thirty values in a scope
 * holding sixty is where a field quietly picks up the wrong neighbour. Here the
 * inputs are named and the output is a value a test can look at.
 */

import { VerseData, VideoCanvasConfigLike } from '@/lib/projectPayloadTypes';

export interface ProjectPayloadInput {
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahStart: number;
  ayahEnd: number;
  reciterId: string;
  reciterName: string;
  audioUrl: string;
  audioDurationSeconds: number;
  verses: VerseData[];
  config: VideoCanvasConfigLike;
}

/** `2:05` -- what the saved-projects list shows, so it is stored ready to read. */
export function formatStoredDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${Math.floor(safe % 60).toString().padStart(2, '0')}`;
}

/** `Al-Fatihah (1:1-7) Clip` -- how a saved project names itself in the drawer. */
export function projectTitle(surahNameEnglish: string, surahNumber: number, ayahStart: number, ayahEnd: number): string {
  return `${surahNameEnglish} (${surahNumber}:${ayahStart}-${ayahEnd}) Clip`;
}

export function buildProjectPayload(input: ProjectPayloadInput): Record<string, unknown> {
  const { config } = input;
  // Config first, named fields after: a styling knob must never be able to
  // shadow the identity of the project it belongs to.
  return {
    ...config,
    title: projectTitle(input.surahNameEnglish, input.surahNumber, input.ayahStart, input.ayahEnd),
    surahNumber: input.surahNumber,
    surahNameArabic: input.surahNameArabic,
    surahNameEnglish: input.surahNameEnglish,
    ayahStart: input.ayahStart,
    ayahEnd: input.ayahEnd,
    reciterId: input.reciterId,
    reciterName: input.reciterName,
    audioUrl: input.audioUrl,
    audioDuration: formatStoredDuration(input.audioDurationSeconds),
    versesJson: input.verses,
  };
}
