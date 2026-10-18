/**
 * Cutting a chapter recording into one file per ayah -- the decisions of
 * `qf-reciters.mjs` for the Quran Foundation's chapter-only reciters, with no
 * network or disk, so they can be tested (src/lib/qfChapterPlan.test.ts).
 *
 * Some of the Foundation's reciters are published only as whole-surah
 * recordings, with ayah and word timings beside them. Those timings are not
 * trusted to cut by: measured on 2026-10-17, Abdullah Ali Jabir's are Saad
 * al-Ghamdi's (they end where Ghamdi's files end, not his), Yasser
 * ad-Dossary's run 4-6 s late on the files now served, and only Al-Muaiqly's
 * and Al-Tunaiji's landed every ayah join in a pause. So every ayah is placed
 * by the aligner, and each join is cut only where three things agree: the
 * aligner's next ayah starts there, the recording is quiet there, and the
 * phoneme model hears nothing said there (or, where the reciter runs one ayah
 * into the next, the Foundation's own timings put the join there too).
 * A chapter with any join that cannot be placed that way is not kept.
 *
 * The cut is between MP3 frames, copied rather than re-encoded, so the ayah
 * files laid end to end are the recording again, bit for bit, and each ayah
 * keeps the length its frames count -- what qfRecitations.ts stitches by.
 */

// -- MP3 frames -----------------------------------------------------------------------------------------------------

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The MPEG layer III frame header at `at`, or null when there is none. */
function frameHeader(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 3;
  const layer = (bytes[at + 1] >> 1) & 3;
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const rate = RATES[version][rateIndex];
  const bitrate = BITRATES[mpeg1 ? 1 : 2][bitrateIndex] * 1000;
  const padding = (bytes[at + 2] >> 1) & 1;
  const mono = bytes[at + 3] >> 6 === 3;
  return {
    rate, bitrate, mono,
    samples: mpeg1 ? 1152 : 576,
    size: Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + padding,
    // Where a Xing/Info/LAME tag would start: after the header and the side information.
    sideInfoEnd: 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17)),
  };
}

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));

/** Where the audio starts: after an ID3v2 tag, when there is one. */
function audioStart(bytes) {
  if (ascii(bytes, 0, 3) !== 'ID3') return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

/**
 * Every audio frame of an MP3 file, in order: `{ offset, size }`, with the
 * rate and samples per frame they share. Leaves out an ID3 tag and the
 * Xing/Info/VBRI frame, which hold no audio. `variable` is whether the
 * bitrate changes from frame to frame (such a file is made constant before it
 * is cut: a passage of it would play without a seek table).
 */
export function mp3Frames(bytes) {
  const frames = [];
  const bitrates = new Set();
  let first = null;
  let at = audioStart(bytes);
  while (at + 4 <= bytes.length) {
    const header = frameHeader(bytes, at);
    // A frame counts only when the next one follows it, so a stray sync word inside audio is not taken for one.
    const next = header && at + header.size;
    if (!header || (next + 4 <= bytes.length && !frameHeader(bytes, next) && ascii(bytes, next, 3) !== 'TAG')) {
      at++;
      continue;
    }
    if (!first) {
      first = header;
      const tag = ascii(bytes, at + header.sideInfoEnd, 4);
      if (tag === 'Xing' || tag === 'Info' || ascii(bytes, at + 36, 4) === 'VBRI') {
        at = next;
        continue;
      }
    }
    if (header.rate !== first.rate || header.samples !== first.samples) {
      at++;
      continue;
    }
    frames.push({ offset: at, size: Math.min(header.size, bytes.length - at) });
    bitrates.add(header.bitrate);
    at = next;
  }
  return { frames, rate: first?.rate ?? 0, samples: first?.samples ?? 0, variable: bitrates.size > 1 };
}

/** The frame a cut at `seconds` falls on: the nearest boundary between frames. */
export const frameAt = (seconds, rate, samples) => Math.max(0, Math.round((seconds * rate) / samples));

/** How long `count` frames play, ms, as `lengthMs` in qf-reciters.mjs counts it. */
export const framesMs = (count, rate, samples) => Math.round(((count * samples * 1000) / rate) * 1000) / 1000;

// -- Loudness -------------------------------------------------------------------------------------------------------

/** How often the recording's loudness is measured, seconds. */
const LEVEL_HOP = 0.02;

/** The loudness of the recording every `hop` seconds, dB; `scale` brings integer samples to -1..1. */
export function levels(pcm, rate, hop = LEVEL_HOP, scale = 1) {
  const step = Math.max(1, Math.round(hop * rate));
  const out = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = i * step; k < (i + 1) * step; k++) sum += pcm[k] * pcm[k];
    out[i] = 10 * Math.log10((sum * scale * scale) / step + 1e-12);
  }
  return out;
}

/** The reciter's level: what 70% of the recording reaches, digital silence left out. */
export function speechLevel(db) {
  const sounding = [...db].filter(level => level > -90).sort((a, b) => a - b);
  return sounding.length ? sounding[Math.floor(sounding.length * 0.7)] : -90;
}

// -- Windows --------------------------------------------------------------------------------------------------------

/** About how much of the recording each aligner call places, and how far past it it reads. */
const WINDOW_SEC = 60;
const LOOKAHEAD_SEC = 20;
/** The rest of a chapter is placed in one call once it is this short. */
const LAST_WINDOW_SEC = 150;

const letterCount = words => words.join('').replace(/[^ء-يٱ]/g, '').length;

/** Seconds per letter over the whole chapter: how long each ayah is guessed to take before it is placed. */
export function chapterPace(verses, duration) {
  const letters = verses.reduce((sum, verse) => sum + letterCount(verse.words), 0);
  return letters ? duration / letters : 0;
}

/**
 * The next aligner call: ayahs `first`-`last` (indexes into `verses`) read
 * from `from` to `to` seconds, keeping the places of `first`-`keep`. The ayahs
 * after `keep` are read too, so the join after the last kept one is placed with
 * the next ayah's start in view; they are placed again by the next call.
 */
export function nextWindow({ verses, first, from, duration, pace, stretch = 1 }) {
  const guess = index => letterCount(verses[index].words) * pace;
  let keep = first;
  let sum = guess(first);
  while (keep + 1 < verses.length && sum < WINDOW_SEC) sum += guess(++keep);
  let last = keep;
  let ahead = 0;
  while (last + 1 < verses.length && ahead < LOOKAHEAD_SEC) ahead += guess(++last);
  const rest = verses.slice(first).reduce((total, _, i) => total + guess(first + i), 0);
  const to = from + (sum + ahead) * 1.1 * stretch + 4;
  if (last === verses.length - 1 || rest <= LAST_WINDOW_SEC || to >= duration) {
    return { first, keep: verses.length - 1, last: verses.length - 1, from, to: duration, final: true };
  }
  return { first, keep, last, from, to, final: false };
}

/** Each ayah's first and last word in an aligner answer, on the recording's clock: `ayah -> {start, end}`. */
export function ayahBounds(words, offset = 0) {
  const bounds = new Map();
  for (const word of words) {
    const ayah = Number(String(word.verse_key).split(':')[1]);
    const seen = bounds.get(ayah) ?? { start: Infinity, end: -Infinity };
    bounds.set(ayah, { start: Math.min(seen.start, word.start + offset), end: Math.max(seen.end, word.end + offset) });
  }
  return bounds;
}

// -- Joins ----------------------------------------------------------------------------------------------------------

/**
 * A join is a pause when it is this far under the reciter's level around it --
 * a real pause in an echoing room fell only 15-18 dB (Saad al-Ghamdi's 1:4,
 * 1:5) -- or reaches the recording's own floor and is at least
 * `FLOOR_DEPTH_DB` under the voice: Ahmed al-Ajmy's recording is so
 * compressed that its pauses are 10 dB under him.
 */
export const PAUSE_DEPTH_DB = 15;
const FLOOR_DEPTH_DB = 8;
/** Within this of the floor is at it. */
const AT_FLOOR_DB = 4;
/** How far either side of a join the reciter's level and the floor are read. */
const SPEECH_AROUND_SEC = 3;
const FLOOR_AROUND_SEC = 10;
/** How far before the next ayah's first word a pause is looked for. */
const LOOK_BACK_SEC = 2;
/** How far after it: the aligner's word starts run a little early or late. */
const LOOK_ON_SEC = 0.15;
/** Within this of the quietest point is as quiet: of those, the stretch nearest the next ayah is taken. */
const NEAR_QUIETEST_DB = 3;
/** How much louder than the quietest point a stretch may be and still be the same lull. */
const LULL_DB = 6;
/** The most of a pause given to the ayah after it, and the least kept clear of that ayah's first sound. */
const LEAD_SEC = 0.3;
const CLEAR_SEC = 0.06;
/** Two of the phoneme model's silences this close are one. */
const SILENCE_JOIN_SEC = 0.08;
/**
 * The furthest a join may be from the Foundation's timing and still be agreed
 * by it: before it, and after it, where it is further because its ayah starts
 * run early -- 0.5 s or more for 63 of 882 words measured, never late
 * (docs/ALIGNMENT.md); Bandar Baleela's 32:11 starts 0.7 s after its timing.
 */
const QF_AGREES_SEC = 0.35;
const QF_EARLY_SEC = 0.8;

/** The phoneme model's silences, with the slivers of sound between them closed. */
export function mergedSilences(silences) {
  const out = [];
  for (const [start, end] of [...(silences ?? [])].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && start - last[1] <= SILENCE_JOIN_SEC) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

const heardNothing = (silences, at) => silences.some(([start, end]) => start <= at && at <= end);

/**
 * The level at frame `i`, averaged over the 100 ms around it inside `lo`-`hi`:
 * a pause between ayahs lasts that long, while the hush of a stop consonant
 * inside a word does not -- Yasser ad-Dossary's 32:23 was first cut 0.4 s
 * into its «وَلَقَدْ» at one.
 */
const smoother = (db, lo, hi) => i => {
  let sum = 0;
  for (let k = i - 2; k <= i + 2; k++) sum += db[Math.min(hi, Math.max(lo, k))];
  return sum / 5;
};

/** The `share` point of the levels within `around` seconds of frame `i`, digital silence left out. */
function levelAround(db, i, around, share, hop) {
  const reach = Math.round(around / hop);
  const near = [...db.subarray(Math.max(0, i - reach), i + reach)].filter(level => level > -90).sort((a, b) => a - b);
  return near.length ? near[Math.floor(near.length * share)] : -90;
}

/**
 * The cut in the lull around frame `pick` (every frame within `LULL_DB` of
 * it, and nearer it than the voice, inside `lo`-`hi`): its middle, or 0.3 s before its end when it is
 * longer, and never nearer its end than 60 ms -- the next ayah's first sound.
 * With what that point is: how far under the reciter, how far over the floor,
 * and whether the phoneme model hears nothing said there.
 */
function cutInLull({ db, pick, lo, hi, silences, hop }) {
  const smooth = smoother(db, lo, hi);
  const speech = levelAround(db, pick, SPEECH_AROUND_SEC, 0.7, hop);
  // A lull reaches no more than halfway back up to the voice -- and in a pause, all of it that is a pause:
  // digital silence (-120 dB) beside a room's near-silence (-90 dB) is one pause, not 40 ms of one
  // (Al-Muaiqly's 21:52, which then looked far from where the Foundation put the join).
  const bar = Math.max(smooth(pick) + Math.min(LULL_DB, (speech - smooth(pick)) / 2),
    Math.min(speech - PAUSE_DEPTH_DB, smooth(pick) + (speech - smooth(pick)) / 2));
  let start = pick;
  let end = pick;
  while (start > lo && smooth(start - 1) <= bar) start--;
  while (end < hi && smooth(end + 1) <= bar) end++;
  const frame = Math.round(Math.max(start, Math.min(Math.max((start + end) / 2, end - LEAD_SEC / hop), end - CLEAR_SEC / hop)));
  const level = smooth(frame);
  const at = Math.round(frame * hop * 1000) / 1000;
  return {
    at,
    // The whole lull the cut is in, which ends at the next ayah's first sound.
    from: Math.round(start * hop * 1000) / 1000,
    until: Math.round(end * hop * 1000) / 1000,
    depth: Math.round((speech - level) * 10) / 10,
    overFloor: Math.round((level - levelAround(db, frame, FLOOR_AROUND_SEC, 0.03, hop)) * 10) / 10,
    heard: heardNothing(silences, at),
  };
}

/** Whether a cut is in a pause: deep under the voice, or at the floor and clear of it, with nothing said there. */
export const inPause = join => join.heard &&
  (join.depth >= PAUSE_DEPTH_DB || (join.overFloor <= AT_FLOOR_DB && join.depth >= FLOOR_DEPTH_DB));

/**
 * Where to cut between one ayah and the next: in the quietest lull the
 * recording has in the two seconds before the next ayah's first word, the one
 * nearest that word when several are as quiet, so a held madd fading out at
 * the end of the ayah before stays with it. `after` is as early as it may be.
 */
export function joinCut({ after, nextStart, db, silences, hop = LEVEL_HOP }) {
  const lo = Math.max(0, Math.ceil(Math.max(after, nextStart - LOOK_BACK_SEC) / hop));
  const hi = Math.min(db.length - 1, Math.floor((nextStart + LOOK_ON_SEC) / hop));
  if (hi <= lo) return cutInLull({ db, pick: Math.min(db.length - 1, Math.max(0, Math.round(nextStart / hop))), lo, hi: lo, silences, hop });
  const smooth = smoother(db, lo, hi);
  let quietest = Infinity;
  for (let i = lo; i <= hi; i++) quietest = Math.min(quietest, smooth(i));
  let pick = lo;
  let distance = Infinity;
  for (let i = lo; i <= hi; i++) {
    const off = Math.abs(i * hop - nextStart);
    if (smooth(i) <= quietest + NEAR_QUIETEST_DB && off < distance) [pick, distance] = [i, off];
  }
  const wide = cutInLull({ db, pick, lo, hi, silences, hop });
  if (inPause(wide)) return wide;
  // No pause before the next ayah: the reciter ran straight on, as Saad al-Ghamdi reads the short surahs
  // (95:1 to 95:2 with 30 ms between). Then the quietest point two seconds back can be inside the ayah
  // before's last word; the join is the dip at the word boundary itself.
  const near = [Math.max(lo, Math.ceil((nextStart - RUN_ON_REACH_SEC) / hop)), Math.min(hi, Math.floor((nextStart + LOOK_ON_SEC) / hop))];
  let lowest = near[0];
  for (let i = near[0]; i <= near[1]; i++) if (smooth(i) < smooth(lowest)) lowest = i;
  return cutInLull({ db, pick: lowest, lo: near[0], hi: near[1], silences, hop });
}

/** How far before the next ayah's first word a join with no pause is looked for. */
const RUN_ON_REACH_SEC = 0.25;

/**
 * Where the first ayah's file starts after an isti'adha or basmala heard
 * before it: in the first pause after the opening's last word. Not where the
 * aligner starts the ayah, which it was not given the opening for and which,
 * for an ayah of separate letters (الٓمٓ, held six counts a letter), it places
 * seconds late: Al-Muaiqly's 32:1 at 14.1 s, not 9.6 s.
 */
export function afterOpening({ openingStart = 0, openingEnd, firstStart, db, silences, hop = LEVEL_HOP }) {
  const lo = Math.max(0, Math.ceil((openingEnd - OPENING_BACK_SEC) / hop));
  const hi = Math.min(db.length - 1, Math.floor((Math.max(firstStart, openingEnd) + LOOK_ON_SEC) / hop));
  const pause = firstPause({ db, lo, hi, silences, hop });
  if (pause) return pause;
  // None there: the aligner can read the opening on over a whole pause and into the ayah -- Al-Muaiqly's 108
  // basmala to 10.55 s, its silence 6.1-7.8 s, «إِنَّآ» from 7.9 s. The last long pause inside what it gave
  // the opening, then: no opening holds one.
  let last = null;
  const from = Math.max(0, Math.ceil(openingStart / hop));
  for (let i = from; i < lo; ) {
    const join = firstPause({ db, lo: i, hi: lo, silences, hop });
    if (!join) break;
    if (quietFor(db, join.at, hop) >= OPENING_LONG_PAUSE_SEC) last = join;
    i = Math.max(i + 1, Math.ceil(join.until / hop) + 1);
  }
  return last ?? joinCut({ after: openingEnd - LOOK_ON_SEC, nextStart: firstStart, db, silences, hop });
}

/**
 * A cut where someone listening has said an ayah starts
 * (scripts/qf-manual-cuts.json): in the pause within half a second of it, so
 * a time read off a player lands in the pause it meant; where there is none --
 * the reciter runs one ayah into the next, as Al-Ajmy reads 20:1-2 -- at the
 * quietest point within 0.15 s, the word boundary they heard. Never before
 * `after`, the cut before it: a pause half a second back can be that one's.
 */
export function manualCut({ at, db, silences, after = 0, hop = LEVEL_HOP }) {
  const quietest = reach => {
    const lo = Math.max(0, Math.ceil(Math.max(after, at - reach) / hop));
    const hi = Math.min(db.length - 1, Math.floor((at + reach) / hop));
    const smooth = smoother(db, lo, hi);
    let pick = lo;
    for (let i = lo; i <= hi; i++) if (smooth(i) < smooth(pick)) pick = i;
    return cutInLull({ db, pick, lo, hi, silences, hop });
  };
  const wide = quietest(MANUAL_REACH_SEC);
  return wide.depth >= PAUSE_DEPTH_DB ? wide : quietest(MANUAL_RUN_ON_SEC);
}

const MANUAL_REACH_SEC = 0.5;
const MANUAL_RUN_ON_SEC = 0.15;

/** The first pause from `lo` on, cut at its quietest point. */
function firstPause({ db, lo, hi, silences, hop }) {
  for (let i = lo; i <= hi; i++) {
    const join = cutInLull({ db, pick: i, lo, hi, silences, hop });
    if (inPause(join)) {
      let pick = i;
      const smooth = smoother(db, lo, hi);
      for (let k = i; k <= hi && smooth(k) <= smooth(i) + LULL_DB; k++) if (smooth(k) < smooth(pick)) pick = k;
      return cutInLull({ db, pick, lo, hi, silences, hop });
    }
  }
  return null;
}

/** A pause this long inside what the aligner reads as the opening is after it: a basmala holds none. */
const OPENING_LONG_PAUSE_SEC = 0.8;

/**
 * How long the recording stays within 20 dB of its level at `at`, either
 * side: the length of a pause that fades, which its quietest stretch is not --
 * Al-Ajmy's 36 is quiet 1.5-2.8 s, falling from -34 to -57 dB.
 */
function quietFor(db, at, hop) {
  const pick = Math.round(at / hop);
  const ceiling = db[pick] + 20;
  let lo = pick;
  let hi = pick;
  while (lo > 0 && db[lo - 1] < ceiling) lo--;
  while (hi < db.length - 1 && db[hi + 1] < ceiling) hi++;
  return (hi - lo + 1) * hop;
}

/**
 * How far before the end the aligner gives the opening its pause is looked
 * for: it reads the opening's last word on into the silence after, and
 * further than the ayah's next word starts -- Saad al-Ghamdi's 68 has his
 * basmala end at 4.95 s and نٓ at 5.01 s, the pause 4.08-4.76 s.
 */
const OPENING_BACK_SEC = 0.6;

/**
 * Whether the Foundation's timings put a join where it was cut: in the lull
 * the cut is in (`join.from` to `join.until`, or the one point given) -- in a
 * long pause they may put the next ayah seconds before the cut and still be
 * in the same silence (Al-Muaiqly's 21:52, 28:65, 30:23, 40:67) -- between
 * the end of one ayah and the start of the next, give or take `QF_AGREES_SEC`
 * before and `QF_EARLY_SEC` after. Each end is the nearer of the ayah's timing
 * and its outer word: a timing often opens half a second before its first
 * word (Abdullah Abu Sharida's 1:5 at 26.7 s, its first word at 27.2 s) or
 * closes after its last (Tahoun's 67:1 at 15.9 s, its last word ending 15.5 s).
 */
/** How wide the Foundation's own gap between two ayahs is, seconds: from the end of one to the start of the next. */
export function qfGap(before, after) {
  if (!Number.isFinite(before?.timestamp_to) || !Number.isFinite(after?.timestamp_from)) return null;
  const firstWord = Number((after.segments ?? [])[0]?.[1]);
  const lastWord = Number((before.segments ?? []).at(-1)?.[2]);
  const opens = Math.max(after.timestamp_from, Number.isFinite(firstWord) ? firstWord : -Infinity);
  const closes = Math.min(before.timestamp_to, Number.isFinite(lastWord) ? lastWord : Infinity);
  return Math.abs(opens - closes) / 1000;
}

export function qfAgrees(join, before, after) {
  if (!Number.isFinite(before?.timestamp_to) || !Number.isFinite(after?.timestamp_from)) return false;
  const { at, from = at, until = at } = typeof join === 'number' ? { at: join } : join;
  const firstWord = Number((after.segments ?? [])[0]?.[1]);
  const lastWord = Number((before.segments ?? []).at(-1)?.[2]);
  const opens = Math.max(after.timestamp_from, Number.isFinite(firstWord) ? firstWord : -Infinity);
  const closes = Math.min(before.timestamp_to, Number.isFinite(lastWord) ? lastWord : Infinity);
  const lo = Math.min(closes, opens) / 1000 - QF_AGREES_SEC;
  const hi = Math.max(closes, opens) / 1000 + QF_EARLY_SEC;
  return until >= lo && from <= hi;
}

/**
 * Whether a join can be kept.
 *
 * Where the Foundation's timings are this recording's (`qfWordsFit`), the
 * join has to be where they put it: the aligner, given ayahs that end and
 * begin alike, can be the one that is wrong -- it started Al-Muaiqly's 32:19
 * at the pause after 32:18's «فَاسِقًا ۚ», reading «لَّا يَسْتَوُۥنَ» as a repeat
 * after it, and that pause passed every other check.
 *
 * Elsewhere the aligner's join stands only where nothing of the ayah before
 * is placed after it (`tangled`), and it is a pause the phoneme model hears
 * nothing in, or a second reading of the two ayahs alone placed it alike
 * (`confirmed`) -- or the Foundation's timings put it there all the same.
 * Nor where the Foundation puts its join in the reciter's voice, and the
 * aligner's is a clean pause (`qfInVoice`, decided where the voice is read).
 * The cut after an opening has no timing of the Foundation's to go by (its
 * timings begin at the ayah): a pause there is enough, or, run straight on,
 * a reading of the opening and the first ayah alone that ends the one there
 * (`confirmed`).
 */
/**
 * The Foundation agreeing with a join counts, for one that is no pause, only
 * where its own gap between the two ayahs is narrow: where the reciter goes
 * back across the join, its gap holds the repeat -- Al-Muaiqly's «فَسَوْفَ
 * تَعْلَمُونَ مَنْ», then the whole again from «فَسَوْفَ» (39:39-40), a gap of
 * 5 s -- and a cut anywhere in it, between «فَسَوْفَ» and «تَعْلَمُونَ» included,
 * fell inside it -- unless a reading of the two ayahs alone puts the cut
 * between them as well (`confirmed`): Al-Ajmy's 1:3-4, «ٱلرَّحِيمِ مَـٰلِكِ», a
 * dip of 14 dB the Foundation's 1.6 s gap and both readings agree on.
 */
export const QF_NARROW_SEC = 1;
const qfCounts = join => join.qf && (inPause(join) || !(join.qfGap > QF_NARROW_SEC) || Boolean(join.confirmed));

/**
 * A second reading is the same aligner again, so it cannot overrule the
 * Foundation where its timings are mostly this recording's: Al-Muaiqly's 49:12
 * was read twice alike, after its first word «يَـٰٓأَيُّهَا», where the Foundation,
 * agreeing with 16 of the surah's 18 joins, put it before.
 */
const QF_MOSTLY = 0.5;
/**
 * Unless the Foundation's start for the ayah is nowhere near the join: then
 * its timings are not of this stretch of the recording, and say nothing of the
 * join -- Al-Ajmy's 74:28, which they start 39 s after the pause his reading
 * of the pair puts it in. Then the recording must all but pause there too
 * (`NEAR_PAUSE_DB`): the reading of the pair is the aligner again, and it
 * stood by Saad al-Ghamdi's 56:53 in his voice.
 */
const QF_NEAR_SEC = 3;
const NEAR_PAUSE_DB = 10;
const qfFar = join => Number.isFinite(join.qfStart) && Math.abs(join.qfStart - join.at) > QF_NEAR_SEC && join.depth >= NEAR_PAUSE_DB;
const bySources = (join, qfFits, qfShare) => qfCounts(join) || join.qfInVoice ||
  (join.opening ? inPause(join) || Boolean(join.confirmed) :
    !qfFits && !join.tangled && (inPause(join) || (join.confirmed && (qfShare < QF_MOSTLY || qfFar(join)))));
/**
 * And a join that is no pause, whatever else agrees with it, only where a
 * reading of its two ayahs alone puts it between their words (`confirmed`);
 * never one that reading clearly puts elsewhere (`contradicted`): Saad
 * al-Ghamdi's 80:6 was cut in the pause before 80:5's last word.
 */
const joinTrusted = (join, qfFits, qfShare) => Boolean(join.manual) || (!join.contradicted &&
  bySources(join, qfFits, qfShare) && (join.opening || inPause(join) || Boolean(join.confirmed)));

// -- The chapter ----------------------------------------------------------------------------------------------------

/** What every window of a chapter must reach: how far what the recogniser heard agrees with the text placed there. */
export const MIN_AGREEMENT = 0.45;
/** No ayah, however short, is less than this. */
export const MIN_AYAH_SEC = 0.3;
/** How far apart the cuts two windows make of one join may be. */
const TWICE_CUT_SEC = 0.15;
/** The share of joins the Foundation's timings have to agree with for its word timings to be kept. */
const QF_WORDS_SHARE = 0.9;

/**
 * Whether a chapter's cuts can be kept, and why not: every window read the
 * text it was given, every join is trusted, every join two windows placed is
 * cut alike from both, and no ayah is shorter than a word.
 */
export function chapterProblems({ windows, joins, cuts, duration, db = null, hop = LEVEL_HOP }) {
  const problems = [];
  const qfFits = qfWordsFit(joins);
  const qfShare = joins.length ? joins.filter(join => join.qf).length / joins.length : 0;
  for (const window of windows) {
    if (!(window.agreement >= MIN_AGREEMENT)) problems.push(`${window.from.toFixed(1)}-${window.to.toFixed(1)}s read ${window.agreement ?? 'nothing'} of its text`);
  }
  for (const join of joins) {
    if (!joinTrusted(join, qfFits, qfShare)) problems.push(`the join before ayah ${join.ayah} (${join.at}s) is not where the Foundation's timings put it, nor a pause or a second reading the aligner's alone stands on`);
  }
  // Placed by two windows, a join has to be cut alike from both -- unless the Foundation's timings agree with
  // it, when they and the pause settle it however the aligner placed it.
  for (const join of joins) {
    // Two cuts in one pause agree, however far apart: Al-Muaiqly's 49:11, 0.18 s apart in one silence.
    const samePause = inPause(join) && join.secondCut >= join.from - TWICE_CUT_SEC && join.secondCut <= join.until + TWICE_CUT_SEC;
    if (join.secondCut !== undefined && !join.qf && !join.manual && !samePause && Math.abs(join.secondCut - join.at) > TWICE_CUT_SEC) {
      problems.push(`the join before ayah ${join.ayah} was cut at ${join.at}s from one window and at ${join.secondCut}s from the next`);
    }
  }
  const edges = [...cuts, duration];
  for (let i = 0; i + 1 < edges.length; i++) {
    if (edges[i + 1] - edges[i] < MIN_AYAH_SEC) problems.push(`ayah ${i + 1} would be ${(edges[i + 1] - edges[i]).toFixed(2)}s`);
    else if (db && !voiced(db, edges[i], edges[i + 1], hop)) problems.push(`ayah ${i + 1} would hold no voice (${edges[i]}-${edges[i + 1]}s)`);
  }
  return problems;
}

/**
 * Whether anything is said between two cuts: somewhere louder than a pause
 * under the recording's voice. Saad al-Ghamdi's 44 has no basmala; its «حمٓ»
 * was taken for one, and 44:1's file was the pause after it.
 */
function voiced(db, from, to, hop) {
  const floor = speechOf(db) - PAUSE_DEPTH_DB;
  for (let i = Math.max(0, Math.floor(from / hop)); i < Math.min(db.length, Math.ceil(to / hop)); i++) if (db[i] > floor) return true;
  return false;
}

const speechLevels = new WeakMap();
const speechOf = db => {
  if (!speechLevels.has(db)) speechLevels.set(db, speechLevel(db));
  return speechLevels.get(db);
};

/** Whether the Foundation's word timings are for this recording: its joins agree with the cuts. */
export const qfWordsFit = joins => joins.length === 0 || joins.filter(join => join.qf).length / joins.length >= QF_WORDS_SHARE;

/**
 * One ayah's word timings within its file, ms: `[word number, start, end]`,
 * from the Foundation's chapter timings when they fit the recording, else
 * from the aligner's words. Clamped to the file, and none left there with no
 * length: a timing outside the file says nothing of where the word is in it
 * (the aligner's second reading of Al-Ajmy's 50:17, past its file's end).
 */
export function ayahSegments({ fromMs, ms, qf, words }) {
  const clamp = value => Math.max(0, Math.min(ms, Math.round(value)));
  const inFile = segment => segment[2] > segment[1];
  if (qf) {
    return (qf.segments ?? []).filter(segment => Array.isArray(segment) && segment.length >= 3)
      .map(([number, start, end]) => [Number(number), clamp(Number(start) - fromMs), clamp(Number(end) - fromMs)])
      .filter(segment => segment.every(Number.isFinite) && inFile(segment));
  }
  return [...(words ?? [])].sort((a, b) => a.start - b.start)
    .map(word => [word.word_index + 1, clamp(word.start * 1000 - fromMs), clamp(word.end * 1000 - fromMs)])
    .filter(inFile);
}

/**
 * The ayahs that open on letters said by name (الٓمٓ, يسٓ, حمٓ, عٓسٓقٓ...), which the
 * aligner hears only at their last letter: where its words time an ayah, the
 * first of these starts with the file. The same list is in
 * src/lib/publishedPhrases.ts (`SEPARATE_LETTERS`).
 */
export const SEPARATE_LETTERS = new Set([
  '2:1', '3:1', '7:1', '10:1', '11:1', '12:1', '13:1', '14:1', '15:1', '19:1', '20:1', '26:1', '27:1', '28:1', '29:1',
  '30:1', '31:1', '32:1', '36:1', '38:1', '40:1', '41:1', '42:1', '42:2', '43:1', '44:1', '45:1', '46:1', '50:1', '68:1',
]);

// -- Content Sync ---------------------------------------------------------------------------------------------------

/** A chapter-recitation snapshot's surah files and ayah timings, by surah: `surah -> { file, ayahs }`. */
export function chapterRecordsBySurah(records) {
  const bySurah = new Map();
  const entry = surah => bySurah.get(surah) ?? bySurah.set(surah, { file: null, ayahs: [] }).get(surah);
  for (const record of records ?? []) {
    const surah = Number(record.chapter_id);
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) continue;
    if (record.record_type === 'chapter_audio_file') {
      const kept = entry(surah).file;
      // One file a surah; where two are listed, the one changed last.
      if (!kept || Date.parse(record.updated_at ?? '') > Date.parse(kept.updated_at ?? '')) entry(surah).file = record;
    } else if (record.record_type === 'audio_segment') {
      entry(surah).ayahs.push(record);
    }
  }
  return bySurah;
}

/**
 * Whether a chapter cut on disk no longer matches the snapshot: another
 * recording, the same one changed since, or its timings changed after the cut.
 */
export function cutStale(chapter, fresh) {
  const source = chapter?.source;
  if (!source || !fresh?.file) return true;
  if (source.url !== fresh.file.audio_url || Number(source.size) !== Number(fresh.file.file_size)) return true;
  const cutAt = Date.parse(source.cutAt ?? '');
  const changed = [fresh.file, ...fresh.ayahs].map(record => Date.parse(record.updated_at ?? '')).filter(Number.isFinite);
  return !Number.isFinite(cutAt) || changed.some(at => at > cutAt);
}
