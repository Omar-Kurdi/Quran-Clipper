/**
 * Drawing the waqf signs where the mushaf prints them, in a face that will not.
 *
 * `wrapCaption` already joins each sign to the word before it, which is what
 * every Unicode face needs to place it at all. Two of them then place it well:
 * Digital Khatt raises it over the end of the word. Indopak Nastaleeq does
 * not: it gives the sign no width and draws it 0.2em clear of the word, so
 * فَلَا تَحْسَبَنَّهُم بِمَفَازَةٍ مِّنَ ٱلْعَذَابِ ۖ ended on a sign floating on its
 * own past the last word. The face carries no anchor for these signs on
 * Uthmani text, which is not the script it was drawn for.
 *
 * So a face is asked how it draws a sign, and only one that lands it clear of
 * its word has the sign drawn separately, over the word's last letter. The
 * height is the face's own -- drawn alone, this face sets the sign exactly as
 * it does joined -- so only the horizontal place changes.
 */

/** The small high signs the mushaf writes over a word to say how to stop there. */
const WAQF_SIGNS = /[ۖ-ۜ]+(?=\s|$)/g;

/** How far over the end of its word a moved sign sits, as a share of the type size. */
const OVER_THE_WORD = 0.3;

export interface DetachedSign {
  sign: string;
  /** The line, without its signs, up to the end of the word this one follows. */
  before: string;
}

/** A wrapped line with its waqf signs taken out, and where each one was. */
export function detachWaqfSigns(line: string): { bare: string; signs: DetachedSign[] } {
  const signs: DetachedSign[] = [];
  let bare = '';
  let from = 0;
  for (const match of line.matchAll(WAQF_SIGNS)) {
    bare += line.slice(from, match.index);
    signs.push({ sign: match[0], before: bare });
    from = match.index + match[0].length;
  }
  bare += line.slice(from);
  return { bare, signs };
}

/** Where a right-to-left line drawn at `x` ends on the right, whichever way it is aligned. */
function rightEdge(x: number, width: number, align: CanvasTextAlign): number {
  if (align === 'right' || align === 'start') return x;
  if (align === 'left' || align === 'end') return x + width;
  return x + width / 2;
}

/**
 * `fillText` for a line of Arabic, with each waqf sign over its word.
 *
 * Expects `ctx.direction` to be `rtl` and `ctx.font` already set. In every face
 * that places the signs itself this is exactly `fillText`.
 */
export function fillArabicLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, size: number): void {
  const { bare, signs } = detachWaqfSigns(line);
  const probe = signs.length ? ctx.measureText(signs[0].sign) : null;
  // A sign with width of its own, or one that already reaches back over its
  // word, is placed by the face; moving it would only be a second guess.
  if (!probe || probe.width > 0 || probe.actualBoundingBoxRight >= 0) {
    ctx.fillText(line, x, y);
    return;
  }
  ctx.fillText(bare, x, y);
  const align = ctx.textAlign;
  const right = rightEdge(x, ctx.measureText(bare).width, align);
  const shift = -probe.actualBoundingBoxRight + OVER_THE_WORD * size;
  ctx.textAlign = 'right';
  for (const { sign, before } of signs) {
    ctx.fillText(sign, right - ctx.measureText(before).width + shift, y);
  }
  ctx.textAlign = align;
}
