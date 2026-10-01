/**
 * Drawing the words of an ayah one at a time -- revealed as they are recited,
 * or the one being recited picked out.
 *
 * Arabic letters change shape with their neighbours, but only within a word:
 * a space ends the joining, so a word drawn on its own at its place in the
 * line is the word as the line draws it. Each word is therefore drawn whole
 * and by itself, through `fillArabicLine`, at the place the line gives it.
 *
 * Not by clipping the drawn line to each word's stretch, which is what this
 * first did. A mushaf glyph's ink can reach well past its own advance -- the
 * tail of the final ر of ٱلْحَنَاجِرِ (40:18) runs 0.6em to its left, across the
 * space and under the next word -- so a straight cut anywhere between two
 * words gave that tail to the wrong one, and it lit up a word late.
 */

import { isMarkOnly } from './mushafFonts';
import { fillArabicLine, rightEdge, type TextCanvas } from './waqfMarks';

interface TimedWord {
  arabic: string;
  timestamp?: number;
  excluded?: boolean;
}

const tokensOf = (line: string) => line.trim().split(/\s+/).filter(Boolean);

/** Where a line is drawn, as `fillArabicLine` takes it. */
export interface LinePlace {
  x: number;
  y: number;
  size: number;
}

/** How one word is drawn: how far it has appeared, 0 to 1, and a colour of its own if it has one. */
export interface WordLook {
  amount: number;
  colour?: string;
}

/**
 * The recited time of each word as drawn, line by line, or null when the
 * drawing and the word list cannot be lined up -- then the caption is drawn
 * whole, as it would be with no effect.
 *
 * The lines are what is drawn: the mushaf's glyphs, one per word, or the
 * Unicode words with each waqf sign joined to the word before it, which turns
 * two entries of the word list into one drawn word.
 */
export function drawnWordTimes(words: readonly TimedWord[] | undefined, lines: readonly string[]): (number | undefined)[][] | null {
  if (!words?.length) return null;
  const drawn = lines.map(tokensOf);
  const count = drawn.reduce((sum, tokens) => sum + tokens.length, 0);
  const shown = words.filter(word => !word.excluded);
  let times = shown.map(word => word.timestamp);
  if (times.length !== count) {
    const visible = shown.filter(word => word.arabic);
    times = [];
    visible.forEach((word, index) => {
      if (index === 0 || !isMarkOnly(word.arabic.trim())) times.push(word.timestamp);
    });
  }
  if (times.length !== count || !times.some(at => typeof at === 'number')) return null;
  let next = 0;
  return drawn.map(tokens => tokens.map(() => times[next++]));
}

/**
 * A right-to-left line of Arabic drawn word by word, each as `look` says.
 * Expects what `fillArabicLine` does. A line with every word fully in and
 * none coloured is drawn whole, exactly as with no effect.
 */
export function fillLineByWord(
  ctx: TextCanvas, line: string, at: LinePlace, look: (word: number) => WordLook
): void {
  const tokens = tokensOf(line);
  const looks = tokens.map((_, index) => look(index));
  if (looks.every(each => each.amount >= 1 && !each.colour)) {
    fillArabicLine(ctx, line, at.x, at.y, at.size);
    return;
  }
  const align = ctx.textAlign;
  const base = ctx.globalAlpha;
  const fill = ctx.fillStyle;
  const right = rightEdge(at.x, ctx.measureText(line).width, align);
  ctx.textAlign = 'right';
  tokens.forEach((token, index) => {
    const amount = Math.min(1, Math.max(0, looks[index].amount));
    if (amount <= 0) return;
    // Where the line would start this word: past every word before it and
    // the space after them.
    const before = index === 0 ? 0 : ctx.measureText(`${tokens.slice(0, index).join(' ')} `).width;
    ctx.globalAlpha = base * amount;
    ctx.fillStyle = looks[index].colour ?? fill;
    fillArabicLine(ctx, token, right - before, at.y, at.size);
  });
  ctx.textAlign = align;
  ctx.globalAlpha = base;
  ctx.fillStyle = fill;
}
