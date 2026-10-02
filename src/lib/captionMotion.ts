/**
 * How the captions move: one ayah giving way to the next, and the words of
 * one arriving as they are recited.
 *
 * Everything here is a pure function of the frame's time. The preview paints
 * once per animation frame and the offline encoder paints frame by frame at
 * times it computes itself, both through the same `paintFrame`, so any state
 * carried from one frame to the next would make the export differ from the
 * preview -- and scrubbing to a moment has to show exactly what the export
 * draws there.
 *
 * The defaults are a cut and no word effect, which is one caption at a time,
 * fully drawn: exactly what every project drew before this existed.
 */

export const CAPTION_TRANSITIONS = ['cut', 'crossfade', 'fadeThrough', 'slide', 'zoom'] as const;
export type CaptionTransition = typeof CAPTION_TRANSITIONS[number];

export const WORD_EFFECTS = ['none', 'reveal', 'highlight'] as const;
export type WordEffect = typeof WORD_EFFECTS[number];

export const MOTION_SPEEDS = ['slow', 'normal', 'quick'] as const;
export type MotionSpeed = typeof MOTION_SPEEDS[number];

export interface CaptionMotion {
  transition: CaptionTransition;
  words: WordEffect;
  speed: MotionSpeed;
}

export const DEFAULT_CAPTION_TRANSITION: CaptionTransition = 'cut';
export const DEFAULT_WORD_EFFECT: WordEffect = 'none';
export const DEFAULT_MOTION_SPEED: MotionSpeed = 'normal';

/** What a new clip starts with: no motion. Not carried by presets or from one clip to the next. */
export const MOTION_DEFAULTS = {
  captionTransition: DEFAULT_CAPTION_TRANSITION,
  wordEffect: DEFAULT_WORD_EFFECT,
  motionSpeed: DEFAULT_MOTION_SPEED,
  highlightColor: '',
};

export const asCaptionTransition = (value: unknown): CaptionTransition =>
  CAPTION_TRANSITIONS.includes(value as CaptionTransition) ? value as CaptionTransition : DEFAULT_CAPTION_TRANSITION;
export const asWordEffect = (value: unknown): WordEffect =>
  WORD_EFFECTS.includes(value as WordEffect) ? value as WordEffect : DEFAULT_WORD_EFFECT;
export const asMotionSpeed = (value: unknown): MotionSpeed =>
  MOTION_SPEEDS.includes(value as MotionSpeed) ? value as MotionSpeed : DEFAULT_MOTION_SPEED;

/** A colour of its own for the word being recited, as `#rrggbb`, or '' for the accent. */
export const asHighlightColour = (value: unknown): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';

/** How long one caption takes to give way to the next, in seconds, at each speed. */
export const TRANSITION_SECONDS: Record<MotionSpeed, number> = { slow: 1, normal: 0.6, quick: 0.35 };

/** How far a sliding caption travels, as a share of the frame's height. */
const SLIDE_DISTANCE = 0.03;
/** How small a zooming caption starts, and how large an outgoing one ends. */
const ZOOM_IN_FROM = 0.94;
const ZOOM_OUT_TO = 1.04;
/** How far behind the Arabic the incoming translation starts, as a share of its arrival. */
const TRANSLATION_LAG = 0.3;

/** How long a revealed word takes to appear, in seconds. */
export const WORD_FADE_SECONDS = 0.15;

export interface Timed {
  startTime: number;
  endTime: number;
}

/** One caption as this frame draws it. */
export interface CaptionLayer<V extends Timed> {
  verse: V;
  /** 0-1, the Arabic, the numeral and the divider. */
  opacity: number;
  /** 0-1, the translation, which arrives a little after the Arabic. */
  translationOpacity: number;
  /** Vertical offset, as a share of the frame's height; negative is up. */
  dy: number;
  /** Size about the text's own centre; 1 is as laid out. */
  scale: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const still = <V extends Timed>(verse: V): CaptionLayer<V> =>
  ({ verse, opacity: 1, translationOpacity: 1, dy: 0, scale: 1 });

/**
 * When the change from `from` to `to` runs, as [start, end) in seconds.
 *
 * Always the full length the speed asks for. Where the reciter pauses long
 * enough, it fits in the pause and ends where `to` begins, so the next
 * caption is fully in by its first word. Most recitations run one caption
 * straight into the next, though, and fitting the change into a pause that
 * is not there made it too brief to see; so whatever the pause lacks is
 * shared equally either side of the join -- a change across a join with no
 * pause at all is centred on it. Never past the start of `from` or the end of
 * `to`. With no `from`, this is the first caption arriving on an empty card.
 */
export function transitionWindow(from: Timed | null, to: Timed, speed: MotionSpeed): [number, number] {
  const wanted = TRANSITION_SECONDS[speed];
  if (!from) return [to.startTime - Math.min(wanted, Math.max(0, to.startTime)), to.startTime];
  const pause = Math.max(0, to.startTime - from.endTime);
  const overrun = Math.max(0, wanted - pause) / 2;
  return [Math.max(from.startTime, to.startTime - wanted + overrun), Math.min(to.endTime, to.startTime + overrun)];
}

/** The outgoing and incoming captions at `p`, 0 to 1 through the change. */
function between<V extends Timed>(
  from: V | null, to: V, p: number, transition: Exclude<CaptionTransition, 'cut'>
): CaptionLayer<V>[] {
  const eased = easeInOut(clamp01(p));
  // A cross-fade overlaps the two; every other change lets one go before the
  // other arrives, since two ayahs moving through each other is hard to read.
  const outgoing = transition === 'crossfade' ? eased : clamp01(eased * 2);
  const incoming = transition === 'crossfade' ? eased : clamp01(eased * 2 - 1);
  // Both are kept even while one is invisible, so the frame always knows
  // which ayah it is between -- the badge reads it from here.
  const layers: CaptionLayer<V>[] = [];
  if (from) {
    const opacity = 1 - outgoing;
    layers.push({
      verse: from,
      opacity,
      translationOpacity: opacity,
      dy: transition === 'slide' ? -SLIDE_DISTANCE * outgoing : 0,
      scale: transition === 'zoom' ? 1 + (ZOOM_OUT_TO - 1) * outgoing : 1,
    });
  }
  layers.push({
    verse: to,
    opacity: incoming,
    translationOpacity: clamp01((incoming - TRANSLATION_LAG) / (1 - TRANSLATION_LAG)),
    dy: transition === 'slide' ? SLIDE_DISTANCE * (1 - incoming) : 0,
    scale: transition === 'zoom' ? ZOOM_IN_FROM + (1 - ZOOM_IN_FROM) * incoming : 1,
  });
  return layers;
}

/**
 * The captions to draw at `time`, from the bottom up. Mid-change both are
 * listed, though one may be fully transparent.
 *
 * `sorted` is in order of start time. `beforeFirst` is what to show before the
 * first caption begins: the preview shows that caption so an idle studio is
 * never an empty card, while the export shows nothing and lets it arrive.
 */
export function captionLayers<V extends Timed>(
  sorted: readonly V[],
  time: number,
  motion: CaptionMotion,
  beforeFirst: 'show' | 'hide'
): CaptionLayer<V>[] {
  if (sorted.length === 0) return [];
  let current = -1;
  for (let i = 0; i < sorted.length && sorted[i].startTime <= time; i++) current = i;

  if (motion.transition !== 'cut') {
    // The change into the current caption may still be finishing, and the one
    // into the next may have begun; each only within its own window.
    for (const to of [current + 1, current]) {
      if (to < 0 || to >= sorted.length) continue;
      const from = to > 0 ? sorted[to - 1] : null;
      if (!from && beforeFirst === 'show') continue;
      const [start, end] = transitionWindow(from, sorted[to], motion.speed);
      if (time >= start && time < end) return between(from, sorted[to], (time - start) / (end - start), motion.transition);
    }
  }

  if (current >= 0) return [still(sorted[current])];
  return beforeFirst === 'show' ? [still(sorted[0])] : [];
}

/** The layer that speaks for the frame -- the badge follows it: the incoming one once it is the more visible. */
export function leadingLayer<V extends Timed>(layers: readonly CaptionLayer<V>[]): CaptionLayer<V> | null {
  return layers.reduce<CaptionLayer<V> | null>((lead, layer) => (!lead || layer.opacity >= lead.opacity ? layer : lead), null);
}

/**
 * How far each drawn word has appeared at `time`, 0 to 1, for the reveal.
 *
 * A word with no time of its own appears with the one before it, and the
 * first with the caption.
 */
export function revealedWords(times: readonly (number | undefined)[], captionStart: number, time: number): number[] {
  let previous = captionStart;
  return times.map(at => {
    const from = typeof at === 'number' ? at : previous;
    previous = from;
    return clamp01((time - from) / WORD_FADE_SECONDS);
  });
}

/** The word being recited at `time`, for the highlight, or -1 before the first and once the caption has ended. */
export function recitedWord(times: readonly (number | undefined)[], captionEnd: number, time: number): number {
  if (time >= captionEnd) return -1;
  let found = -1;
  times.forEach((at, index) => {
    if (typeof at === 'number' && at <= time) found = index;
  });
  return found;
}
