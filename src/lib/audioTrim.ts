/**
 * Client-side audio trimming.
 *
 * Decodes the uploaded file, slices the buffer to the selected window, and
 * re-encodes it as a WAV file. The rest of the app -- matching, the `<audio>`
 * player, `MediaRecorder` export -- already assumes one clip starting at 0,
 * so producing a real trimmed file is simpler than threading a trim offset
 * through every consumer of `audioUrl`/`audioDuration`/`verses`.
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  return window.AudioContext || (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
}

/** Decodes a file into an `AudioBuffer`. The context is closed immediately after -- it's only needed for the decode call itself. */
export async function decodeAudioFile(file: File | Blob): Promise<AudioBuffer> {
  const Ctor = getAudioContextCtor();
  const ctx = new Ctor();
  try {
    const bytes = await file.arrayBuffer();
    return await ctx.decodeAudioData(bytes);
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Per-bucket peak amplitude (0-1), the max across all channels in that time slice. For drawing a waveform. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let b = 0; b < buckets; b++) {
      // Fractional boundaries, so bucket b really does cover b/buckets to
      // (b+1)/buckets of the audio and the last one reaches the end. Rounding
      // the bucket size down instead left the tail uncovered and stretched
      // every bucket slightly to fill the width it was drawn across.
      const start = Math.floor((b * data.length) / buckets);
      const end = Math.max(start + 1, Math.min(data.length, Math.floor(((b + 1) * data.length) / buckets)));
      let peak = 0;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      if (peak > peaks[b]) peaks[b] = peak;
    }
  }
  return peaks;
}

function sliceBuffer(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const startFrame = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(endSec * buffer.sampleRate));
  const frameCount = Math.max(1, endFrame - startFrame);
  // The AudioBuffer constructor needs no AudioContext -- it's a plain data
  // container, so allocating one here (and closing it) would be pointless.
  const sliced = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: frameCount, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    sliced.copyToChannel(buffer.getChannelData(channel).subarray(startFrame, startFrame + frameCount), channel);
  }
  return sliced;
}

/** Standard 16-bit PCM WAV encoder. Lossless, and every consumer here (the `<audio>` element, the sidecar, Gemini) already accepts WAV. */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const blockAlign = numChannels * 2;
  const dataSize = numFrames * blockAlign;

  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}

export type TrimResult = { file: File; url: string; duration: number };

/** Slices an already-decoded buffer to `[startSec, endSec]` and wraps the result as a downloadable/playable File. */
export function buildTrimmedFile(buffer: AudioBuffer, startSec: number, endSec: number, originalName: string): TrimResult {
  const clampedStart = Math.max(0, Math.min(startSec, buffer.duration));
  const clampedEnd = Math.max(clampedStart + 0.05, Math.min(endSec, buffer.duration));
  const sliced = sliceBuffer(buffer, clampedStart, clampedEnd);
  const blob = audioBufferToWav(sliced);
  const baseName = originalName.replace(/\.[^./]+$/, '') || 'audio';
  const file = new File([blob], `${baseName}-trimmed.wav`, { type: 'audio/wav' });
  return { file, url: URL.createObjectURL(file), duration: sliced.duration };
}
