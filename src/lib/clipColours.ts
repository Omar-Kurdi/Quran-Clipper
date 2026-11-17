/**
 * One colour per clip, in turn, shared by everything that names a clip -- its
 * tab, its bar on the timeline's lane and its row in Source -- so a clip is
 * the same colour wherever it is seen, and overlapping clips can be told apart.
 */
const COLOURS = [
  { bar: 'border-amber-400/70 bg-amber-400/15 text-amber-100', dot: 'bg-amber-400' },
  { bar: 'border-emerald-400/70 bg-emerald-400/15 text-emerald-100', dot: 'bg-emerald-400' },
  { bar: 'border-violet-400/70 bg-violet-400/15 text-violet-100', dot: 'bg-violet-400' },
  { bar: 'border-sky-400/70 bg-sky-400/15 text-sky-100', dot: 'bg-sky-400' }
];

/** The colour of the clip at this place in play order. */
export const clipColour = (index: number) => COLOURS[((index % COLOURS.length) + COLOURS.length) % COLOURS.length];
