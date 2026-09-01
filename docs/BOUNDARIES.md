# Boundary detection: what is measured (test.mp3 33:21-23, test2.mp3 23:93-96)

Ground truth = user's per-segment description. Score = exact word-range matches.

| approach | test.mp3 | test2.mp3 | verdict |
|---|---|---|---|
| current (energy p15, dip>=0.20s) | 6/11 miss=0 | 5/5 miss=0 | baseline |
| energy sweep, 24 settings | max 7/11 | -- | DEAD END |
| ... more candidates (dip>=0.08s) | 2-5/11 miss=6-22 | 0-2/5 | much WORSE |
| blank-posterior candidates, 24 settings | max 2/11, 15-19 seg | max 4/5 | DEAD END |
| ORACLE hand-placed boundaries | 8/11 miss=0 | -- | ceiling |

## Why more candidates hurt
The nemo path (`assign_phrase_ranges_by_decode`) uses every candidate as a
forced split -- it cannot decline one. `detect_boundaries` documents its output
as candidates "for the search to choose from", but only the wav2vec2 path
(`assign_phrase_ranges`) actually searches them. Extra candidates therefore
cut mid-word, produce fragment decodes, and lose words outright.

## Why the wanted boundaries are invisible to energy
28.60s and 36.50s (both wanted) have CTC blank posterior 0.998 / 1.000 -- they
are unambiguous pauses -- but neither falls below the *global* p15 energy
threshold, because a breath inside a loud passage is not quiet in absolute terms.

## Why blank posterior alone cannot replace energy
The model emits blank between every word, not only at breaths, so thresholding
it floods the candidate list (15-19 segments where 11 are wanted).

## Residual errors that are NOT boundary problems
Even with oracle boundaries, 3/11 fail:
* 22.73-28.71 decodes without its final word (`قَالُوا`) -- greedy CTC drops
  words at a window edge. Decoding 27.0-28.8 alone yields `قَالُوا` correctly.
* `قالوا` is recited TWICE (27.0-28.8 and 28.7-30.5). The linear reference
  cannot represent that; it shows up as a 1.43s "hole" in the forced alignment.
  Restarts are recovered from the decode instead: a phrase said twice matches
  the same place twice and the overlap becomes a restart segment.
* The decoder's leading conjunction is unstable at phrase edges -- it writes
  `وَقَالُوا` where the reference has `قَالُوا۟`, and `صَدَقَ` where the reference
  has `وَصَدَقَ`. `_skeleton` treats those as entirely different tokens.

## Consequence for the plan
Widening candidates is only safe once the assignment can decline one. So the
span search comes first, and is the thing to build.

## When a phrase may span two candidates
Nothing in a text-match score prefers a split: a longer window has more context
and no cut words, so it reads back at least as well. An unconditional search
therefore merges every boundary it is offered, which on test3.mp3 turned two
correct segments either side of an audible pause into one 21-second segment.

Merging needs positive evidence that the boundary was wrong, and two signals
together supply it:

* **stranded reference words** -- the windows either side do not join up, so
  text fell between them;
* **a fragment at the joint** -- the decoder read back orthography with no
  consonants in it (`َةُ` for the tail of `ٱلسَّيِّئَةَ`, `ُ` for the tail of
  `وَمِنْهُم`), which only happens when a cut went through a word.

The second is what distinguishes a broken boundary from a good boundary next to
a word the decoder simply garbled. `مُصَلًّى` read back as `مُصًا` strands a word
too, but the window after it starts cleanly on `وَعَهِدْنَآ`; merging there would
destroy a real pause. Orphan recovery is the right repair for that case, and it
already handles it.

## Orthography the decoder and Uthmani disagree about
Three separate cases, all found the same way -- a word that never matched:

| Uthmani | plain | mark | handling |
|---|---|---|---|
| `ٱلظَّـٰلِمِينَ` | `الظالمين` | superscript alef U+0670 | drop every alef from the skeleton |
| `شَيْـًٔا` | `شَيْئًا` | hamza above U+0654 vs the letter `ئ` | fold hamza seats |
| `إِبْرَٰهِـۧمَ` | `إبراهيم` | small high yeh U+06E7 | write it back as `ي` |

The superscript alef cannot be written back as `ا`, because the words whose
plain spelling *also* omits it (`هذا`, `ذلك`, `الله`, `الرحمن`) would then stop
matching; dropping the letter on both sides collapses the two spellings
instead. The small high **waw** is the same trap in reverse (`رَبُّهُۥ` is plainly
`ربه`, not `ربوه`) and is left stripped. Dropping `و` and `ي` wholesale, for
symmetry with alef, was tried and is worse: 388 -> 387 on relocation and
test2.mp3 fell from 5/5 to 4/5.

Relocation of phrases written in decoder orthography: 360 -> 388 of 400.


## What actually solved it: the mushaf's own stop signs

Every acoustic approach above failed for the same reason. On test.mp3 a **1.91s
pause** sits in the middle of a phrase that must not be split, while a break the
listener plainly hears has only **0.56s** of quiet. No threshold on loudness or
on pause length orders those two correctly, because what separates them is where
the sentence ends, not how quiet it got.

Waqf marks (U+06D6..U+06DC) are the tradition's annotation of exactly that, and
they are already in the Uthmani text the aligner loads. Measured against the
ground truth for three clips:

* **18 of 26** segment ends fall on a waqf mark or an ayah end;
* the gap at a waqf mark runs to a **1.41s median** against **0.24s** between
  ordinary words (n=7 vs n=117);
* the one waqf mark the ground truth does *not* break at sits at 0.24s -- the
  reciter carried straight through it.

So a mark is *permission* and the reciter's own timing is the *decision*. The
threshold is a multiple of each recitation's median inter-word gap, which keeps
it free of any one reading's tempo. This took test.mp3 from 7/11 to 9/11 and
found the 36.5s break that no dip setting ever did.

## What is still unsolved: repeats

Every remaining failure across all three clips is one class -- text the reciter
said that no segment shows.

* test.mp3 33:22 -- `قَالُوا۟` is recited **twice** (27.0-28.8s and 28.7-30.5s,
  confirmed by decoding those windows directly). A straight-line reference has
  one of it, so the two utterances cannot both be captioned.
* test3.mp3 2:125 -- `أَن طَهِّرَا` is audible at 93-97s (that span decodes to
  `وَطَهرًا`) but the segment covering it was assigned only up to `وَإِسْمَـٰعِيلَ`,
  and forced alignment then smeared the extra speech into that last word.

Both repeats are real, and confirmed rather than inferred: decoding overlapping
windows around 94-99s of test3 gives `'طرًا منطَهِّرًا'` -- two utterances -- and
27.0-28.8s and 28.7-30.5s of test.mp3 each decode to `قَالُوا`.

A gap-filling `detect_repeats` was written for this and removed after measuring
worse than the decode-derived restarts; see docs/ALIGNMENT.md.

An earlier note here said the blocker was that comparing target sequences of
different lengths needs a length-normalised score. **That was wrong.**
`torchaudio.functional.forced_align` returns one score per *frame*, and
`_fill_score` sums those, so two candidate scripts are already scored over the
same frames. There is nothing to normalise.

The actual blockers are two, and both are about the emission rather than the
scoring:

1. **The aligner's emission is deaf where the repeat is.** `compute_emission`
   stitches 30s windows, and NeMo normalises features per window; over the
   frames carrying test3's second `أَن طَهِّرَا` the stitched emission puts ~0.99
   blank probability on audio measuring -16.5 dB, while a chunk emission of the
   same span reads `وَطَهْرًا` clearly. Any likelihood test run against the
   stitched emission is asking a model that cannot hear the evidence.
2. **The chunk emission does not support it either, when scored.** Aligning
   test3's window 84.75-97.38 against the correct 6-word script scored
   -8.58/frame against -7.89 for the incomplete 4-word one -- adding words that
   a listener can hear still made the path worse. The second utterance is
   quieter and faster than the first, and the posteriors do not carry it
   strongly enough for a forced-alignment likelihood to find it.

So repeat handling needs better evidence, not better arithmetic. Until then
these cases under-cover rather than mis-cover: the words are missing from a
caption, never wrong in one.

## A promising direction that did not land
The chunk and clip-wide emissions make *different* mistakes -- over three clips
the chunk reading won 5 windows, the clip-wide reading won 6, and 18 were level.
Keeping whichever matches the reference better repairs several failures at the
point of first reading rather than leaving repair passes to notice a word went
missing: `وَصَدَقَ` 0.93 -> 1.00, `تَبْدِيلًا` 0.80 -> 1.00, `ٱلسَّيِّئَةَ` 0.00 -> 1.00,
`وَأَنِّى` 0.00 -> 0.67.

It was tried and **reverted**. Reading windows that previously matched nothing
turns them into one-word segments wedged between segments that already cover
them, and the grouping downstream is not ready for that: four follow-on fixes
(prefix-aware fragment detection, suppressing assignments that explain no new
words, routing unclaimed audio by which segment owns the words it reads, and
ranking ties toward fewer phrases) recovered test2 and test.mp3 but still left
test3 two segments worse than without it. Worth returning to, with the grouping
reworked first rather than patched.


## Repeats, resolved and unresolved

A repeat at the **end** of a segment is now recovered (`_extend_over_repeated_tail`).
The reciter says a phrase's closing words again before going on, leaving audio
the segment's own words do not account for. Two approaches failed first and are
worth not retrying:

* scoring the tail acoustically -- the clip-wide emission puts ~0.99 blank
  probability on those frames despite -16.5 dB of audio, and against the
  phrase's own emission the correct longer script *still* aligns worse than the
  incomplete short one (-8.58 vs -7.89 per frame);
* matching the tail by word -- it read back as `وَ عِنَبًاطَهِّرًا`, which shares no
  whole word with the reference and scores 0.00.

Matching by **character** works, because garbling scrambles which letters land
in which token but leaves most of the letters: `وعنبطهر` against `نطهر` agrees
on four of them, and picks the right two words at 0.73.

A repeat in the **middle** of a segment is not recoverable the same way: the
hole is short (1.44s on test.mp3) and an isolated chunk that size decodes to
noise (`طم`).

### test.mp3 33:22 has no signal at all
The break the listener hears after `قَالُوا۟` cannot be found, and this is now
settled rather than open:

* it is **not** a repeat. Earlier notes here said `قَالُوا۟` was recited twice,
  inferred from two overlapping windows each decoding one. That was wrong --
  a single window spanning both (26.5-31.4s) decodes `قَالُوا` exactly once, so
  the two were the same utterance bleeding across a window edge;
* 33:22 words 1-10 carry **no waqf mark**, so the pause-mark splitter has
  nothing to act on;
* no energy candidate falls near 28.6s, and loosening the dip threshold to
  produce one costs more than it gains (measured above).

It is a breath the reciter took where the mushaf marks no stop. Fixing it needs
a signal none of audio energy, CTC blank posterior, decoded text, or the
reference orthography carries -- most likely a phrase/prosody model. Left
unfixed deliberately.
