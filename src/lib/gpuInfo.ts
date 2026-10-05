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

/**
 * Whether a renderer string is a stand-in rather than the card.
 *
 * Browsers answer the renderer question with a generic value to keep sites
 * from fingerprinting the machine: Firefox reports a bucketed model ("NVIDIA
 * GeForce GTX 980, or similar") whatever is fitted, and Brave reports its own
 * name. Printed as "Detected GPU", the first read as the server's card to a
 * person exporting from a desktop with an RTX 5080 -- so a stand-in is not
 * shown as a GPU at all.
 */
export function isPlaceholderRenderer(name: string): boolean {
  return /or similar/i.test(name) || /^(brave|firefox|mozilla|chrome|chromium|safari|webkit|opera|edge)$/i.test(name.trim());
}

/** Whether the "GPU" is software drawing on the processor: a machine with no graphics hardware the browser can use. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name);
}

/** The graphics card's real name, or null when the browser hides it, offers a stand-in, or draws in software. */
export function realGpuName(name: string | null = detectGpuRenderer()): string | null {
  return name && !isPlaceholderRenderer(name) && !isSoftwareRenderer(name) ? name : null;
}

/** The card's real name for the `exports` record, or a plain statement that it was not given. */
export function describeGpu(): string {
  return realGpuName() ?? 'GPU not reported by browser';
}

/**
 * Whether this device has a hardware H.264 encoder the browser will use, or
 * null when the browser cannot say. Without one, WebCodecs encodes on the
 * processor -- slower, but the same file: a PC with no graphics card, or a
 * phone whose encoder the browser does not expose, still exports.
 */
export async function hasHardwareEncoder(width = 1080, height = 1920): Promise<boolean | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640028', width, height, hardwareAcceleration: 'prefer-hardware'
    });
    return Boolean(supported);
  } catch {
    return null;
  }
}

/**
 * Which container/codec `MediaRecorder` will actually pick. Whether it lands on
 * a hardware encoder is not observable from JS -- Chromium usually encodes VP8
 * and VP9 in software via libvpx -- so this names the codec, not the silicon.
 */
/**
 * What the finished file will actually be encoded as.
 *
 * Two paths produce two different files, and naming the recorder's codecs on a
 * render that WebCodecs will handle is simply wrong -- that render comes out
 * H.264 in MP4. `fastPath` is the same answer `canExportOffline` gives, so the
 * label follows the render rather than the browser's recorder support.
 */
export function describeEncoder(fastPath = false): string {
  if (fastPath) return 'H.264 + AAC';
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
