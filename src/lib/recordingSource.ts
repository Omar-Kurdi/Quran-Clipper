/**
 * Which recording an upload is, by its bytes: the SHA-256 of the file, as hex.
 *
 * A clip of a recording is saved as a project of its own, with its own cut of
 * the audio, so nothing it stores about its audio says which recording it was
 * cut from. This does: the recording's project and every clip's carry it
 * (`AudioTags.source`), and Projects lists the clips under that recording.
 * The server's copy of a long upload is kept under the same hash
 * (`editSources`).
 */

/** The hex SHA-256 of a recording, or null where the browser will not hash it (an insecure page). */
export async function recordingSource(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** What a stored source looks like; anything else is not one. */
export const RECORDING_SOURCE = /^[0-9a-f]{64}$/;

/**
 * Whether an upload is the recording a project restored without its audio is
 * waiting for, and may be taken as that project's own. By its bytes where both
 * sides know them; by its file name only where either does not -- a row saved
 * before sources were kept, or a page that will not hash. Anything else is a
 * different recording, and taking it would put one recitation under another's
 * captions.
 */
export function isAwaitedRecording(
  upload: { source: string | null; name: string },
  awaited: { source?: string | null; fileName: string }
): boolean {
  if (upload.source && awaited.source) return upload.source === awaited.source;
  return upload.name === awaited.fileName;
}
