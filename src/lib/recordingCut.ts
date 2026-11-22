/**
 * A stretch cut from a recording saved in Projects without opening it: what
 * moving a clip's end by an ayah needs (`nudgeClip`). A long recording is cut
 * by the server from the copy it keeps of it, by its source; a shorter one
 * from the copy this browser keeps (`projectAudio.ts`).
 */

import { buildTrimmedFile, decodeAudioFile } from './audioTrim';
import { normalizeAudioTags } from './audioTags';
import { isLongAudio } from './longAudio';
import { loadProjectAudio } from './projectAudio';
import { cutLongStretch } from '@/hooks/useLongAudio';

/**
 * [start, end] of `recording` -- a saved row -- as a file to keep as a clip's
 * audio; `reach` is how long the recording is, as far as is known. Throws
 * when neither copy is to hand.
 */
export async function cutFromSavedRecording(
  recording: Record<string, unknown>, window: { start: number; end: number }, reach: number
): Promise<File> {
  const name = String(recording.audioFileName || 'recording');
  const source = normalizeAudioTags(recording.audioTags)?.source;
  if (isLongAudio(reach) && source) {
    // The server keeps a long recording by its source; with nothing to send again if it let it go.
    const wav = await cutLongStretch(new File([], name), { id: source, duration: reach }, window.start, window.end, 'wav');
    return new File([wav], name.replace(/\.[^./]+$/, '-clip.wav'), { type: 'audio/wav' });
  }
  const blob = typeof recording.audioKey === 'string' && recording.audioKey ? await loadProjectAudio(recording.audioKey) : null;
  if (!blob) throw new Error('no audio');
  return buildTrimmedFile(await decodeAudioFile(new File([blob], name)), window.start, window.end, name).file;
}
