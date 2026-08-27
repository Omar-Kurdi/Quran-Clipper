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
