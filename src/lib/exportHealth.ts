/**
 * Whether a finished export is actually watchable.
 *
 * Export records the canvas in real time: `captureStream` takes frames as the
 * canvas is painted, and the audio comes from a separate element playing
 * alongside. Nothing ties the two together. When the browser stops painting --
 * the tab goes to the background, the machine sleeps, another window takes the
 * GPU -- `requestAnimationFrame` stops firing, the canvas stops changing, and
 * the video track simply holds its last frame. The audio keeps going, because
 * media playback is not throttled the way animation is.
 *
 * So the export does not fail. It succeeds, at the right length, with the
 * right audio, and a picture frozen over part of it. The recorder cannot tell,
 * and neither can the user until they watch the whole thing back.
 *
 * Measuring it is possible because the two clocks can be compared: audio time
 * advances in real time regardless, so painted frames per second of audio is
 * the true capture rate. This is the arithmetic on those samples; VideoCanvas
 * collects them.
 */

export interface ExportHealth {
  /** Seconds of audio recorded. */
  recordedSeconds: number;
  /**
   * Seconds of the recording during which the canvas painted too slowly to be
   * a moving picture. These are the stretches that come out frozen.
   */
  starvedSeconds: number;
  /** Frames painted per second of recorded audio, over the whole export. */
  effectiveFps: number;
  /** Whether the tab was in the background at any point during the recording. */
  wasHidden: boolean;
  /**
   * How many times the export was held while the tab was hidden.
   *
   * Not a fault -- it is the mechanism working. Worth reporting only because
   * it explains why a two-minute clip took five minutes to render.
   */
  pauses: number;
}

/**
 * Painting slower than this fraction of the requested rate is not a slow
 * render, it is a stall. Genuine GPU load gives 20-40 fps against a 60 fps
 * request; a backgrounded tab gives 0-1.
 */
const STALLED_BELOW = 0.25;

/** A shortfall in the average rate that a viewer would notice as choppiness. */
const CHOPPY_BELOW = 0.6;

/**
 * A whole second of frozen picture is visible to anyone watching. Below that
 * it is a hitch, and hitches happen on any machine at the start of a render.
 */
const FREEZE_SECONDS = 1;

export type ExportVerdict = 'clean' | 'choppy' | 'frozen';

/**
 * Accumulates one progress sample.
 *
 * Both deltas are measured against audio time rather than wall-clock, which is
 * what makes this survive the very condition it exists to detect: a hidden tab
 * throttles timers to about one tick a second, so a wall-clock rate computed
 * from those ticks would be measuring the sampler, not the render.
 */
export function accumulateStarvation(
  health: ExportHealth,
  framesPainted: number,
  audioSeconds: number,
  targetFps: number
): ExportHealth {
  if (audioSeconds <= 0) return health;
  const rate = framesPainted / audioSeconds;
  return {
    ...health,
    recordedSeconds: health.recordedSeconds + audioSeconds,
    starvedSeconds:
      rate < targetFps * STALLED_BELOW
        ? health.starvedSeconds + audioSeconds
        : health.starvedSeconds,
  };
}

export function exportVerdict(health: ExportHealth, targetFps: number): ExportVerdict {
  if (health.starvedSeconds >= FREEZE_SECONDS) return 'frozen';
  if (health.recordedSeconds > 0 && health.effectiveFps < targetFps * CHOPPY_BELOW) return 'choppy';
  return 'clean';
}

export function emptyHealth(): ExportHealth {
  return { recordedSeconds: 0, starvedSeconds: 0, effectiveFps: 0, wasHidden: false, pauses: 0 };
}
