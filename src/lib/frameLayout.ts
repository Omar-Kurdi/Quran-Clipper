/**
 * Where things sit on the frame.
 *
 * `paintFrame` used to carry one arrangement as literals: the badge at 12% of
 * the height, the card from 23% to 75%, the waveform at 88%. A layout is that
 * arrangement as a value, so the frame can be arranged more than one way and
 * the preview, the offline encoder and the render check all read the same
 * positions.
 *
 * Everything is a fraction of the frame, so a layout holds at every aspect
 * ratio. The text inside a box is still sized by the shrink-to-fit search, so
 * a small box gets smaller type rather than text off the frame.
 */

export type FrameLayoutId = 'card' | 'lower-third' | 'top' | 'open' | 'split';

export const FRAME_LAYOUTS: FrameLayoutId[] = ['card', 'lower-third', 'top', 'open', 'split'];

export const DEFAULT_FRAME_LAYOUT: FrameLayoutId = 'card';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLayout {
  id: FrameLayoutId;
  /** The box the Arabic is fitted into -- and the translation too, unless `translation` is set. */
  text: Box;
  /** A second box for the translation, when the layout separates the two. */
  translation: Box | null;
  /** Whether the boxes get a card behind them; `open` sets the text on the picture. */
  drawsCard: boolean;
  /** Top edge of the surah badge. */
  badgeY: number;
  /** Centre line of the waveform bars. */
  waveY: number;
}

/** A layout's boxes as fractions of the frame: [x, y, width, height]. */
type Fractions = [number, number, number, number];

const SHAPES: Record<FrameLayoutId, {
  text: Fractions;
  translation?: Fractions;
  drawsCard: boolean;
  badgeY: number;
  waveY: number;
}> = {
  // Today's arrangement, to the pixel: every project saved before layouts
  // existed has none, and must render exactly as it did.
  card: { text: [0.08, 0.23, 0.84, 0.52], drawsCard: true, badgeY: 0.12, waveY: 0.88 },
  // The words in the bottom third, the footage left clear above them. The
  // waveform moves above the card rather than sitting on it.
  'lower-third': { text: [0.06, 0.6, 0.88, 0.31], drawsCard: true, badgeY: 0.06, waveY: 0.54 },
  'top': { text: [0.08, 0.13, 0.84, 0.45], drawsCard: true, badgeY: 0.04, waveY: 0.88 },
  // No card at all: a larger box, and the text carries itself on its shadow.
  open: { text: [0.06, 0.2, 0.88, 0.62], drawsCard: false, badgeY: 0.08, waveY: 0.9 },
  // The Arabic and the translation in blocks of their own.
  split: {
    text: [0.08, 0.17, 0.84, 0.38],
    translation: [0.08, 0.6, 0.84, 0.26],
    drawsCard: true,
    badgeY: 0.07,
    waveY: 0.92,
  },
};

const toBox = ([x, y, w, h]: Fractions, width: number, height: number): Box =>
  ({ x: width * x, y: height * y, width: width * w, height: height * h });

/** A stored value as a layout, with anything unknown read as today's card. */
export function asFrameLayout(value: unknown): FrameLayoutId {
  return FRAME_LAYOUTS.includes(value as FrameLayoutId) ? (value as FrameLayoutId) : DEFAULT_FRAME_LAYOUT;
}

export function frameLayout(id: unknown, width: number, height: number): FrameLayout {
  const layout = asFrameLayout(id);
  const shape = SHAPES[layout];
  return {
    id: layout,
    text: toBox(shape.text, width, height),
    translation: shape.translation ? toBox(shape.translation, width, height) : null,
    drawsCard: shape.drawsCard,
    badgeY: height * shape.badgeY,
    waveY: height * shape.waveY,
  };
}

/**
 * Where a block of `contentHeight` starts inside `box`: centred, but never
 * closer to the top edge than `padding`.
 */
export function blockTop(box: Box, contentHeight: number, padding: number): number {
  return box.y + Math.max(padding, (box.height - contentHeight) / 2);
}

/**
 * Whether the text fits its boxes.
 *
 * One box takes the whole stack. Two boxes take the Arabic (with the numeral
 * and divider under it) and the translation separately, each against its own
 * room -- a long translation shrinks the type because *its* box is full, not
 * because the two together would overflow a card that is not there.
 */
export function textFits(
  layout: FrameLayout,
  heights: { arabic: number; belowArabic: number; translation: number },
  padding: number
): boolean {
  const room = (box: Box) => box.height - padding * 2;
  if (!layout.translation) {
    return heights.arabic + heights.translation <= room(layout.text) - heights.belowArabic;
  }
  return heights.arabic + heights.belowArabic <= room(layout.text) && heights.translation <= room(layout.translation);
}
