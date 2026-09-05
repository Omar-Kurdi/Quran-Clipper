/**
 * Frequency bars for a frame the audio is not currently playing.
 *
 * The live preview reads an `AnalyserNode`, which by definition reports only
 * what is audible at this instant. Rendering offline has no "this instant" --
 * frames are produced as fast as the machine manages, in a canvas nobody is
 * listening to -- so the bars have to be computed from the decoded samples
 * instead, or they would freeze at whatever the last live reading happened to
 * be and the exported video would not match the preview.
 *
 * A real transform rather than a fudged envelope, because the bars are
 * *frequency* bands: faking them from amplitude alone makes every bar move
 * together, which reads as obviously wrong next to the preview.
 */

const FFT_SIZE = 512;

/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 *
 * Small enough to write out rather than take a dependency for: one 512-point
 * transform per frame is a few microseconds, and a ten-minute export at 60fps
 * needs 36,000 of them -- well under a second in total.
 */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < len / 2; k++) {
        const aReal = real[i + k];
        const aImag = imag[i + k];
        const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
        const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
        real[i + k] = aReal + bReal;
        imag[i + k] = aImag + bImag;
        real[i + k + len / 2] = aReal - bReal;
        imag[i + k + len / 2] = aImag - bImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

/**
 * Reads the spectrum at `atSeconds` in the same shape an `AnalyserNode` gives:
 * `frequencyBinCount` bytes, 0-255, one per bin.
 *
 * Matching that shape exactly is the point -- the drawing code is shared with
 * the live preview, so anything else here would mean two versions of it.
 */
export function spectrumAt(
  samples: Float32Array,
  sampleRate: number,
  atSeconds: number,
  out: Uint8Array
): Uint8Array {
  const bins = FFT_SIZE / 2;
  const start = Math.round(atSeconds * sampleRate) - FFT_SIZE / 2;
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  for (let i = 0; i < FFT_SIZE; i++) {
    const index = start + i;
    const sample = index >= 0 && index < samples.length ? samples[index] : 0;
    // Hann window, so a slice taken mid-note does not ring across every bin.
    real[i] = sample * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  fft(real, imag);

  for (let i = 0; i < bins && i < out.length; i++) {
    const magnitude = Math.hypot(real[i], imag[i]) / (FFT_SIZE / 4);
    // Decibels, mapped over the same range an AnalyserNode uses by default
    // (-100 to -30 dB), so the bars stand at comparable heights to the preview.
    const db = 20 * Math.log10(magnitude + 1e-9);
    out[i] = Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
  }
  for (let i = bins; i < out.length; i++) out[i] = 0;
  return out;
}

export const SPECTRUM_BINS = FFT_SIZE / 2;
