/**
 * The recitation a saved project was built from.
 *
 * A project used to store `audioUrl` verbatim, which for an upload is a `blob:`
 * url -- valid only for the tab that minted it. Reopening the project found
 * nothing, and re-uploading the original file was worse than useless: a trimmed
 * timeline's verse times are rebased to the *trimmed* clip, so playing them
 * against the untrimmed original put every caption `trimStart` seconds early
 * while the studio, having forgotten the trim, showed no sign anything was
 * wrong.
 *
 * So the audio itself is kept here, in the same database the uploaded
 * backgrounds live in. What is stored is the file the timeline actually
 * belongs to -- after a trim that is the trimmed clip, not the original -- so
 * restoring is a read and a fresh object url, with nothing to recompute.
 *
 * The trim window is stored *beside* it in the project row rather than here,
 * because it answers a different question: not "what does this timeline play
 * against" but "where did that come from". That is what lets a project whose
 * stored audio has been evicted still reproduce itself from the original file,
 * and what lets the studio name the file to ask for.
 */

import { idbPut, idbGet, idbDelete } from './idb';

/**
 * Where a project's audio sits in time within the file it was cut from.
 *
 * Always against the *original* upload, however many trims deep: the studio
 * compounds these rather than replacing them, so a second trim's zero is the
 * first trim's start.
 */
export interface TrimWindow {
  start: number;
  end: number;
}

/**
 * Keyed by the audio rather than by the project.
 *
 * "Save" creates a new row each time rather than updating one, and several
 * projects can be saved from a single recording. Keying by project id would
 * therefore write the same file once per save; keying by the audio means one
 * copy, referenced by however many projects were cut from it. A new key is
 * minted only when the file itself changes -- which a trim does, since the
 * timeline then belongs to the trimmed clip and the previous project still
 * needs the previous one.
 */
export const newAudioKey = (): string =>
  `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Stores the audio a project plays.
 *
 * `false` means it did not persist -- out of quota, or storage unavailable.
 * The project still saves and still works this session; it simply will not find
 * its audio again, and the caller says so rather than letting that be a
 * surprise on reopening. The file name and trim window travel with the project
 * either way, so the fallback path stays available.
 */
export function storeProjectAudio(key: string, file: File): Promise<boolean> {
  return idbPut('audio', key, file);
}

/** The stored audio, or null when it was never stored or has since been evicted. */
export function loadProjectAudio(key: string): Promise<Blob | null> {
  return idbGet('audio', key);
}

/**
 * Drops audio nothing references any more.
 *
 * Deleting a project must not take the recording with it while another project
 * cut from the same upload is still saved, so the caller passes the keys still
 * in use and this refuses when the key is among them.
 */
export async function forgetProjectAudio(key: string, keysStillInUse: string[]): Promise<void> {
  if (!key || keysStillInUse.includes(key)) return;
  await idbDelete('audio', key);
}
