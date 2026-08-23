/**
 * Real GPU / encoder reporting.
 *
 * The studio used to hardcode "NVIDIA GeForce RTX 5080" everywhere, including
 * into the `exports.gpu_device` column, so saved records claimed hardware the
 * machine might not have. These helpers report what the browser actually
 * exposes, and say "unknown" when it exposes nothing.
 */

/**
 * The renderer string from `WEBGL_debug_renderer_info`, e.g.
 * "NVIDIA GeForce RTX 5080/PCIe/SSE2". Returns null when the extension is
 * blocked -- Firefox and Safari withhold it as a fingerprinting surface.
 */
export function detectGpuRenderer(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof renderer === 'string' && renderer.trim() ? renderer.trim() : null;
  } catch {
    return null;
  }
}

/** `detectGpuRenderer()` with a caller-friendly fallback, for display and for the `exports` record. */
export function describeGpu(): string {
  return detectGpuRenderer() ?? 'GPU not reported by browser';
}

/**
 * Which container/codec `MediaRecorder` will actually pick. Whether it lands on
 * a hardware encoder is not observable from JS -- Chromium usually encodes VP8
 * and VP9 in software via libvpx -- so this names the codec, not the silicon.
 */
export function describeEncoder(): string {
  if (typeof MediaRecorder === 'undefined') return 'unavailable';
  for (const [mime, label] of [
    ['video/webm;codecs=vp9,opus', 'WebM VP9 + Opus'],
    ['video/webm;codecs=vp8,opus', 'WebM VP8 + Opus'],
    ['video/webm', 'WebM']
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return label;
  }
  return 'unavailable';
}
