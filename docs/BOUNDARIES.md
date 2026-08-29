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
  `detect_repeats` exists for this but is not wired into the by_decode path.
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

`detect_repeats` exists for this and is **not wired into the decode path**.
Wiring it in is blocked on a real problem, not just plumbing: deciding whether
extra words belong in a segment means comparing target sequences of *different
lengths*, and `_fill_score` sums log-probabilities over the target, so a longer
script always scores lower whether or not it is correct. Measured on test3, the
correct 6-word script scored -1.23/frame against -0.39 for the incomplete
4-word one. The gain-over-blank normalisation `detect_repeats` uses does not fix
this either, because CTC emits blank on nearly every frame -- the blank baseline
over 46 frames of *speech* came to -0.3, i.e. ~0.99 blank probability per frame.

A length-normalised model comparison is needed before repeat handling can be
trusted here. Until then these cases will under-cover rather than mis-cover:
the words are missing from a caption, never wrong in one.
