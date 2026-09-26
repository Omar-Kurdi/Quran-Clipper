/**
 * The surah badge, in each of the styles it can be drawn in.
 *
 * Moved out of `paintFrame` when it grew styles: the pill is today's badge,
 * drawn exactly as it was, and the others are alternatives to it. Turning the
 * badge off is still `showSurahBadge` -- there is no "none" style, so a preset
 * or an old project that hid the badge keeps hiding it.
 */

import { SURAHS_LIST } from './quranData';
import { SURAH_NAME_FAMILY, surahNameText } from './mushafFonts';

export type BadgeStyle = 'pill' | 'calligraphic' | 'frame' | 'corner';

export const BADGE_STYLES: BadgeStyle[] = ['pill', 'calligraphic', 'frame', 'corner'];

export const DEFAULT_BADGE_STYLE: BadgeStyle = 'pill';

/** The id `/api/studio` reports when the surah-name face is not installed. */
export const SURAH_NAME_FONT_ID = 'surah-name';
/** Where that face lives under `public/`. */
export const SURAH_NAME_FONT_FILE = 'fonts/surah-name/surah-name-v4.woff2';

/** A stored value as a style, with anything unknown read as the pill. */
export function asBadgeStyle(value: unknown): BadgeStyle {
  return BADGE_STYLES.includes(value as BadgeStyle) ? (value as BadgeStyle) : DEFAULT_BADGE_STYLE;
}

/**
 * The style that will actually be drawn. The calligraphic heading needs its
 * face; without it the ligature is never formed and the frame would show the
 * literal `surah009`, so a server without the file draws the pill.
 */
export function usableBadgeStyle(value: unknown, missingFonts: ReadonlySet<string>): BadgeStyle {
  const style = asBadgeStyle(value);
  return style === 'calligraphic' && missingFonts.has(SURAH_NAME_FONT_ID) ? DEFAULT_BADGE_STYLE : style;
}

/** `2:255-257`, or `2:286 → 3:5` across a surah boundary. */
export function badgeRange(
  firstKey: string | undefined,
  lastKey: string | undefined,
  fallback: { surah: number; start: number; end: number }
): string {
  if (!firstKey || !lastKey) return `${fallback.surah}:${fallback.start}-${fallback.end}`;
  return firstKey.split(':')[0] === lastKey.split(':')[0]
    ? `${firstKey}-${lastKey.split(':')[1]}`
    : `${firstKey} → ${lastKey}`;
}

/**
 * Which surah the badge names while a caption is on screen.
 *
 * A clip that runs from one surah into the next names the one being recited,
 * not the one it started in. The project's own names are used for its own
 * surah, since those are what the studio has been showing; any other comes
 * from the surah list.
 */
export function badgeSurah(
  verseKey: string | undefined,
  project: { number: number; nameArabic: string; nameEnglish: string }
): { number: number; nameArabic: string; nameEnglish: string } {
  const surah = Number(verseKey?.split(':')[0]);
  if (!Number.isInteger(surah) || surah === project.number) return project;
  const other = SURAHS_LIST.find(entry => entry.number === surah);
  return other ? { number: surah, nameArabic: other.nameArabic, nameEnglish: other.nameEnglish } : project;
}

export interface BadgeInput {
  style: BadgeStyle;
  width: number;
  height: number;
  /** Top edge, from the frame layout. The corner tag ignores it. */
  y: number;
  accent: string;
  surah: { number: number; nameArabic: string; nameEnglish: string };
  range: string;
  /** The user's own badge text, which replaces the generated title. */
  customTitle: string;
  subtitle: string;
  /** Which corner the watermark is in, so the corner tag takes another. */
  watermarkPosition: string;
  /** The face for text that is not Quran text. */
  labelFamily: string;
  /** 0 to 1: how much of the footage the plate hides. */
  plateOpacity: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type Rect = { x: number; y: number; w: number; h: number };

/** `roundRect` where the engine has it, and the same path by hand where it does not. */
function roundRect(ctx: Ctx, { x, y, w, h }: Rect, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Where a line of text's glyphs actually land, which `textBaseline` does not say. */
function ink(ctx: Ctx, text: string, font: string) {
  ctx.font = font;
  const m = ctx.measureText(text);
  return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent, width: m.width };
}

/** The largest size, from `start` down to `floor` in steps of `step`, at which `text` fits `room`. */
function fittedSize(
  ctx: Ctx,
  text: string,
  fontAt: (size: number) => string,
  { start, floor, room, step }: { start: number; floor: number; room: number; step: number }
) {
  let size = start;
  ctx.font = fontAt(size);
  while (ctx.measureText(text).width > room && size > floor) {
    size -= step;
    ctx.font = fontAt(size);
  }
  return size;
}

/**
 * Draws lines centred on `centreX`, stacked by their ink and centred as a
 * whole between `top` and `top + boxHeight`.
 */
function drawStack(
  ctx: Ctx,
  lines: { text: string; font: string; colour: string }[],
  { centreX, top, boxHeight, gap }: { centreX: number; top: number; boxHeight: number; gap: number }
) {
  const measured = lines.map(line => ({ ...line, ...ink(ctx, line.text, line.font) }));
  const total = measured.reduce((sum, line) => sum + line.ascent + line.descent, 0) + gap * (lines.length - 1);
  let inkTop = top + (boxHeight - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const line of measured) {
    ctx.font = line.font;
    ctx.fillStyle = line.colour;
    ctx.fillText(line.text, centreX, inkTop + line.ascent);
    inkTop += line.ascent + line.descent + gap;
  }
}

/** How opaque the plate behind the badge is when a project does not say: today's badge. */
export const DEFAULT_BADGE_OPACITY = 74;

const plate = (input: BadgeInput) => `rgba(6, 9, 16, ${input.plateOpacity})`;
const SUBTITLE_INK = 'rgba(237, 241, 247, 0.92)';

/** Today's badge: a rounded plate with the title and an optional subtitle. */
function paintPill(ctx: Ctx, input: BadgeInput, scale: number) {
  const { width, y, accent, labelFamily, subtitle } = input;
  const badgeWidth = width * 0.72;
  const badgeX = (width - badgeWidth) / 2;
  const title = input.customTitle || `سُورَةُ ${input.surah.nameArabic} • ${input.surah.nameEnglish} (${input.range})`;

  // Shrink to fit rather than spill past the plate.
  const titleAt = (size: number) => `bold ${size}px '${labelFamily}', serif`;
  const titleSize = fittedSize(ctx, title, titleAt, { start: 34 * scale, floor: 16 * scale, room: badgeWidth - 44 * scale, step: scale });
  const subtitleSize = 20 * scale;
  const titleFont = titleAt(titleSize);
  const subtitleFont = `600 ${subtitleSize}px 'Inter', sans-serif`;

  // Placed by where the glyphs actually are: `textBaseline: 'middle'` centres
  // on the em box, and Amiri's Arabic ink sits well above it -- it pushed the
  // diacritics of سُورَةُ through the border.
  const titleInk = ink(ctx, title, titleFont);
  const subtitleInk = subtitle ? ink(ctx, subtitle, subtitleFont) : { ascent: 0, descent: 0 };
  const stackGap = subtitle ? 8 * scale : 0;
  const contentHeight = titleInk.ascent + titleInk.descent + stackGap + subtitleInk.ascent + subtitleInk.descent;

  // The plate keeps its height so the badge does not resize with every change
  // of wording; the max() is only a floor, for ink that cannot fit otherwise.
  const badgeHeight = Math.max(
    subtitle ? titleSize + subtitleSize + 34 * scale : titleSize + 34 * scale,
    contentHeight + 12 * scale
  );

  ctx.fillStyle = plate(input);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, 2 * scale);
  roundRect(ctx, { x: badgeX, y, w: badgeWidth, h: badgeHeight }, badgeHeight / 2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 6 * scale;
  drawStack(ctx, [
    { text: title, font: titleFont, colour: accent },
    ...(subtitle ? [{ text: subtitle, font: subtitleFont, colour: SUBTITLE_INK }] : []),
  ], { centreX: width / 2, top: y, boxHeight: badgeHeight, gap: stackGap });
}

/**
 * The surah's name as a mushaf heads it: QUL's calligraphic glyph, large,
 * with the reference small beneath it -- one label, the way a printed page
 * reads, rather than the name on one line and the numbers on another.
 */
function paintCalligraphic(ctx: Ctx, input: BadgeInput, scale: number) {
  const { width, y, accent, labelFamily, subtitle } = input;
  // Capped by the height too, so a 16:9 frame gets a heading, not a banner.
  const plateWidth = Math.min(width, input.height) * 0.62;
  const plateX = (width - plateWidth) / 2;
  const glyph = surahNameText(input.surah.number);
  const reference = input.customTitle || `${input.surah.nameEnglish} · ${input.range}`;

  const glyphFont = `${64 * scale}px '${SURAH_NAME_FAMILY}'`;
  const referenceAt = (size: number) => `600 ${size}px '${labelFamily}', 'Inter', serif`;
  const referenceSize = fittedSize(ctx, reference, referenceAt, { start: 22 * scale, floor: 12 * scale, room: plateWidth - 60 * scale, step: scale });
  const lines = [
    { text: glyph, font: glyphFont, colour: accent },
    { text: reference, font: referenceAt(referenceSize), colour: SUBTITLE_INK },
    ...(subtitle ? [{ text: subtitle, font: `600 ${18 * scale}px 'Inter', sans-serif`, colour: SUBTITLE_INK }] : []),
  ];
  const gap = 10 * scale;
  const content = lines.reduce((sum, line) => {
    const m = ink(ctx, line.text, line.font);
    return sum + m.ascent + m.descent;
  }, 0) + gap * (lines.length - 1);
  const plateHeight = content + 36 * scale;

  ctx.fillStyle = plate(input);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  roundRect(ctx, { x: plateX, y, w: plateWidth, h: plateHeight }, 18 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 6 * scale;
  drawStack(ctx, lines, { centreX: width / 2, top: y, boxHeight: plateHeight, gap });
}

/** A small diamond, the ornament at each end of the frame. */
function diamond(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
}

/**
 * The frame a mushaf draws around a surah heading: a rectangle ruled twice,
 * with an ornament at each end, and the title inside.
 */
function paintFrame(ctx: Ctx, input: BadgeInput, scale: number) {
  const { width, y, accent, labelFamily, subtitle } = input;
  const frameWidth = Math.min(width, input.height) * 0.8;
  const frameX = (width - frameWidth) / 2;
  const title = input.customTitle || `سُورَةُ ${input.surah.nameArabic}`;
  const reference = `${input.surah.nameEnglish} · ${input.range}`;
  const inner = frameWidth - 120 * scale;

  const titleAt = (size: number) => `bold ${size}px '${labelFamily}', serif`;
  const titleSize = fittedSize(ctx, title, titleAt, { start: 40 * scale, floor: 16 * scale, room: inner, step: scale });
  const lines = [
    { text: title, font: titleAt(titleSize), colour: accent },
    { text: subtitle || reference, font: `600 ${18 * scale}px 'Inter', sans-serif`, colour: SUBTITLE_INK },
  ];
  const gap = 8 * scale;
  const content = lines.reduce((sum, line) => {
    const m = ink(ctx, line.text, line.font);
    return sum + m.ascent + m.descent;
  }, 0) + gap;
  const frameHeight = content + 40 * scale;

  ctx.fillStyle = plate(input);
  ctx.fillRect(frameX, y, frameWidth, frameHeight);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, 3 * scale);
  ctx.strokeRect(frameX, y, frameWidth, frameHeight);
  const inset = 7 * scale;
  ctx.lineWidth = Math.max(1, 1 * scale);
  ctx.strokeRect(frameX + inset, y + inset, frameWidth - inset * 2, frameHeight - inset * 2);

  ctx.fillStyle = accent;
  const midY = y + frameHeight / 2;
  diamond(ctx, frameX + 30 * scale, midY, 9 * scale);
  diamond(ctx, frameX + frameWidth - 30 * scale, midY, 9 * scale);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 6 * scale;
  drawStack(ctx, lines, { centreX: width / 2, top: y, boxHeight: frameHeight, gap });
}

/**
 * A small tag in a top corner, leaving the middle of the frame to the picture.
 * It takes whichever top corner the watermark is not in.
 */
function paintCorner(ctx: Ctx, input: BadgeInput, heightScale: number) {
  const { width, height, accent, labelFamily } = input;
  // Sized by the frame's short side rather than its height: a tag this small
  // scaled by the height of a 16:9 frame came out at 13px.
  const scale = Math.max(heightScale, Math.min(width, height) / 1080);
  const title = input.customTitle || `${input.surah.nameArabic} • ${input.surah.nameEnglish} ${input.range}`;
  const margin = Math.min(width, height) * 0.04;
  const titleAt = (size: number) => `bold ${size}px '${labelFamily}', serif`;
  const size = fittedSize(ctx, title, titleAt, { start: 28 * scale, floor: 12 * scale, room: width * 0.55, step: scale });
  const font = titleAt(size);
  const m = ink(ctx, title, font);
  const padX = 18 * scale;
  const tagWidth = m.width + padX * 2;
  const tagHeight = m.ascent + m.descent + 20 * scale;
  const onRight = input.watermarkPosition === 'top-left';
  const x = onRight ? width - margin - tagWidth : margin;
  const y = margin;

  ctx.fillStyle = plate(input);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  roundRect(ctx, { x, y, w: tagWidth, h: tagHeight }, 10 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 4 * scale;
  drawStack(ctx, [{ text: title, font, colour: accent }], { centreX: x + tagWidth / 2, top: y, boxHeight: tagHeight, gap: 0 });
}

const PAINTERS: Record<BadgeStyle, (ctx: Ctx, input: BadgeInput, scale: number) => void> = {
  pill: paintPill,
  calligraphic: paintCalligraphic,
  frame: paintFrame,
  corner: paintCorner,
};

export function paintSurahBadge(ctx: Ctx, input: BadgeInput) {
  ctx.save();
  // Everything on the canvas scales with height; a fixed pixel size rendered
  // as an illegible strip on a 1080-wide frame.
  PAINTERS[input.style](ctx, input, input.height / 1920);
  ctx.restore();
}
