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
