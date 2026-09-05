/**
 * What to render, for where it is going.
 *
 * Resolution used to be welded to the aspect ratio -- every export was
 * 1080-class at a fixed 12 Mbps -- so "make this look good on Reels" and "make
 * this look good on a television" were the same file. They are not the same
 * file, and the difference matters more here than for most video: every one of
 * these platforms re-encodes what it is given, and a second encode of an
 * already-thin H.264 stream is where Arabic text goes soft at the edges.
 *
 * So the rule these numbers follow is: hand the platform more than it will
 * keep. The upload is not the final copy; it is the source for their encoder,
 * and the headroom is what survives that pass. What stops it being unbounded
 * is memory, not taste -- see `MAX_EXPORT_BYTES`.
 */

export type QualityTier = 'standard' | 'high' | 'max';

export const QUALITY_TIERS: QualityTier[] = ['standard', 'high', 'max'];

export interface ExportPreset {
  id: string;
  /** Which frame shape this platform wants. Selecting a preset switches the studio to it. */
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  /** What the platform plays at. Not a limit -- the user can still choose the other rate. */
  fps: number;
  /** Longest clip the platform accepts, where it has a limit worth warning about. */
  maxSeconds?: number;
}

/**
 * The presets, in the order they are shown.
 *
 * Names and hints live in the dictionaries: these are ids, ratios and limits,
 * which are facts about the platforms rather than words about them.
 */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'tiktok', aspectRatio: '9:16', fps: 30, maxSeconds: 600 },
  { id: 'reels', aspectRatio: '9:16', fps: 30, maxSeconds: 90 },
  { id: 'shorts', aspectRatio: '9:16', fps: 30, maxSeconds: 180 },
  { id: 'ig-portrait', aspectRatio: '4:5', fps: 30, maxSeconds: 90 },
  { id: 'ig-feed', aspectRatio: '1:1', fps: 30, maxSeconds: 90 },
  { id: 'youtube', aspectRatio: '16:9', fps: 60 },
  { id: 'facebook', aspectRatio: '9:16', fps: 30, maxSeconds: 90 }
];

export const presetById = (id: string): ExportPreset =>
  EXPORT_PRESETS.find(preset => preset.id === id) ?? EXPORT_PRESETS[0];

/** The first preset that renders in this shape, for opening the modal on what the studio is set to. */
export const presetForAspect = (aspectRatio: string): ExportPreset =>
  EXPORT_PRESETS.find(preset => preset.aspectRatio === aspectRatio) ?? EXPORT_PRESETS[0];

/** The long edge of each tier. Every frame is built from this and the ratio, so nothing is hardcoded per platform. */
const LONG_EDGE: Record<QualityTier, number> = {
  standard: 1920,
  high: 2560,
  max: 3840
};

const RATIOS: Record<ExportPreset['aspectRatio'], [number, number]> = {
  '9:16': [9, 16],
  '16:9': [16, 9],
  '1:1': [1, 1],
  '4:5': [4, 5]
};

/** H.264 wants even dimensions; an odd one is either refused or silently rounded. */
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function dimensionsFor(aspectRatio: ExportPreset['aspectRatio'], tier: QualityTier): { width: number; height: number } {
  const [w, h] = RATIOS[aspectRatio];
  const long = LONG_EDGE[tier];
  return w >= h
    ? { width: even(long), height: even((long * h) / w) }
    : { width: even((long * w) / h), height: even(long) };
}

/**
 * Bits per pixel per frame.
 *
 * 0.16 is roughly twice what these platforms re-encode to, which is the point:
 * it is chosen to be thrown away. Higher tiers spend fewer bits per pixel
 * because there are far more pixels and the eye does not need them all --
 * 4K at 0.16 would be 40 Mbps of a mostly still frame.
 */
const BITS_PER_PIXEL: Record<QualityTier, number> = {
  standard: 0.16,
  high: 0.12,
  max: 0.08
};

/** Nothing gains from more, and encoders start refusing configurations above it. */
const MAX_BITRATE = 60_000_000;
const MIN_BITRATE = 4_000_000;

/**
 * How large a file this path can actually produce.
 *
 * Not a policy: the muxer holds the entire mp4 in one ArrayBuffer before there
 * is a Blob at all, so this is the point where a render stops being slow and
 * starts being a tab that dies. A plan that would exceed it steps down a tier
 * and says so, which is recoverable; running out of memory forty minutes into
 * a render is not.
 */
export const MAX_EXPORT_BYTES = 1_250_000_000;

export function bitrateFor(width: number, height: number, fps: number, tier: QualityTier): number {
  const raw = width * height * fps * BITS_PER_PIXEL[tier];
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

export interface ExportPlan {
  presetId: string;
  aspectRatio: ExportPreset['aspectRatio'];
  /** The tier actually used, which is not always the one asked for. */
  tier: QualityTier;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  /** What the finished file is expected to weigh, video and audio together. */
  estimatedBytes: number;
  /** Set when the requested tier would not fit in memory and this one was used instead. */
  steppedDownFrom?: QualityTier;
  /** Set when even the lowest tier had to give up bitrate to fit. */
  bitrateReduced: boolean;
  /**
   * Set when the clip is so long that it will not fit even at the lowest
   * bitrate worth rendering. Nothing left to adjust: what is left is to say so
   * before the render, rather than to run out of memory inside it.
   */
  exceedsMemory: boolean;
  /** Set when the clip is longer than the platform accepts. */
  overLongBy?: number;
}

/** Audio rides along at a fixed 128 kbps, which is what the encoder is configured for. */
const AUDIO_BITRATE = 128_000;

const bytesFor = (bitrate: number, seconds: number) => Math.round(((bitrate + AUDIO_BITRATE) * seconds) / 8);

/**
 * Turns a choice of platform and quality into the numbers a render needs.
 *
 * Every adjustment it makes is reported rather than applied quietly: a render
 * that comes out at 1080p when 4K was asked for should say which of the two
 * reasons it was -- the memory ceiling, or the bitrate floor.
 */
export function planExport(input: {
  presetId: string;
  tier: QualityTier;
  fps: number;
  seconds: number;
}): ExportPlan {
  const preset = presetById(input.presetId);
  const seconds = Math.max(0.1, input.seconds);
  const fps = input.fps > 0 ? input.fps : preset.fps;

  let tier = input.tier;
  let steppedDownFrom: QualityTier | undefined;
  let size = dimensionsFor(preset.aspectRatio, tier);
  let bitrate = bitrateFor(size.width, size.height, fps, tier);

  // Step down while the projected file would not fit in one buffer. Fewer
  // pixels beats fewer bits: a clean 1080p is worth more than a starved 4K,
  // and it is also the one the platform will re-encode to anyway.
  while (bytesFor(bitrate, seconds) > MAX_EXPORT_BYTES && tier !== 'standard') {
    steppedDownFrom = steppedDownFrom ?? tier;
    tier = tier === 'max' ? 'high' : 'standard';
    size = dimensionsFor(preset.aspectRatio, tier);
    bitrate = bitrateFor(size.width, size.height, fps, tier);
  }

  // A clip long enough to blow the ceiling at 1080p as well: spend what is
  // left, down to a floor below which the picture is not worth rendering.
  let bitrateReduced = false;
  if (bytesFor(bitrate, seconds) > MAX_EXPORT_BYTES) {
    const affordable = Math.floor((MAX_EXPORT_BYTES * 8) / seconds) - AUDIO_BITRATE;
    bitrate = Math.max(MIN_BITRATE, affordable);
    bitrateReduced = true;
  }

  const overLongBy = preset.maxSeconds && seconds > preset.maxSeconds
    ? Math.ceil(seconds - preset.maxSeconds)
    : undefined;

  return {
    presetId: preset.id,
    aspectRatio: preset.aspectRatio,
    tier,
    width: size.width,
    height: size.height,
    fps,
    bitrate,
    estimatedBytes: bytesFor(bitrate, seconds),
    steppedDownFrom,
    bitrateReduced,
    exceedsMemory: bytesFor(bitrate, seconds) > MAX_EXPORT_BYTES,
    overLongBy
  };
}

/** `1.4 GB`, `220 MB` -- what the modal shows next to the plan. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** `12 Mbps`, rounded the way a bitrate is usually quoted. */
export const formatBitrate = (bitrate: number): string => `${Math.round(bitrate / 100_000) / 10} Mbps`;
