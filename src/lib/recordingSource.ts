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
