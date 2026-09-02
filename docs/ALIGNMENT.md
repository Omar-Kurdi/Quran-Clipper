# How recitation timing works

This document explains why the audio-matching pipeline is built the way it is, and records the
measurements behind the design. All figures come from a 68.5-second reference clip of
Al-Ahzab 33:21–23 and can be reproduced with the scripts in `scripts/`.

---

## The core idea

Timing a recitation looks like one question but is really two:

1. **What was recited?**
2. **When was each word said?**

A speech recogniser answers both at once, which sounds efficient and is the source of nearly
every failure mode. It free-decodes the audio into text, and whatever it mishears is simply
gone. Downstream code then has to reconstruct the truth by fuzzy-searching ~77,000 Quran words
for something resembling the garbled output. An LLM given the same job has the additional
problem that it has no frame-level time grounding at all, so its timestamps are plausible
estimates rather than measurements.

**But for this application the text is already known.** The user picked a surah and ayah range,
or a model can identify the passage without needing to be accurate to the millisecond. Once the
text is treated as a *fixed constraint* rather than something to guess, the second question can
be answered exactly:

> Recognition decides *what* was recited — coarse, error-tolerant, and easy to correct.
> Forced alignment decides *when* — exact, gapless, and unable to invent anything.

That split is the whole architecture.

---

## Why forced alignment is categorically different

Under forced alignment the Quran text becomes a fixed CTC target sequence, and the acoustic
model only chooses which audio frames belong to which character. Three failure modes of the
decode-then-search approach become *structurally impossible* rather than merely less likely:

- **A word cannot go missing.** Every reference word is in the target sequence, so the Viterbi
  path must assign frames to it.
- **A word cannot come back garbled.** The output tokens *are* the Quran text.
- **A phrase cannot land in the wrong surah.** There is no corpus search at all.

### The evidence

The same acoustic model (`jonatasgrosman/wav2vec2-large-xlsr-53-arabic`) was run over the
reference clip both ways.

**Free decoding** produced unusable output — only fragments are recoverable:

```
يرقروا مكملهم في ومسهه نلارسلو قاد كان داداكم في يمسوه ومل نكة الممس ولاتوم كقلس مأثوملإبر ...
```

**Forced alignment of the known text**, same model, same audio:

```
words placed: 53/53
span: 0.18s .. 67.50s   (audio 68.50s)
monotonic: True
```

Read those numbers correctly: full coverage and monotonicity are *properties of the Viterbi
path*, not findings about this recording — the same lines would print even if every timestamp
were wrong. What they establish is the structural claim, which is the one that matters: every
reference word receives a timestamp by construction, and nothing can be dropped, garbled, or
misfiled.

A useful corollary: because the search covers one fixed sequence instead of every possible
sequence, **acoustic model quality matters far less here than for free decoding.** The model
whose transcript above is unreadable placed all 53 words correctly. This is also why alignment
runs comfortably on CPU — about 4 seconds for this clip on an 8-core machine.

---

## What decides what

Splitting "what was recited" from "when" is the architecture, but the split has to be
*enforced*, and for a long time it was not. Reading the audio back decided both: energy dips
fixed the phrase boundaries, each phrase's decode was searched for in the reference, and the
timeline was whatever that search returned. Every stage could go wrong, and one stage going
wrong took the rest with it.

It did, reproducibly. On a 220s recitation of Ghafir 40:13–25:

1. A candidate boundary landed **inside** the word `رِزْقًا`, leaving its tail as a phrase.
2. That tail read back as `ْقًا`, whose consonant skeleton is the single letter `ق`.
3. A one-letter skeleton carries no positional information, and against a corpus of any size it
   finds a perfect match somewhere. It matched `قُوَّةً` — eight ayahs later — at **1.00**, while
   scoring **0.00** against the `رزق` it actually came from.
4. The assignment search kept that route, because at that boundary it was worth +0.97 against
   the honest route's +0.00. The search keyed its state on the boundary alone, so the winner
   *evicted* the honest route rather than running alongside it.
5. Every later phrase then said text now "behind" the surviving route's cursor, and was dropped
   for explaining nothing new — **34 correctly-decoded phrases discarded**.
6. The gap-filling pass handed all 139 unclaimed seconds to the one 0.9s segment before it.

The result was one caption holding a single word for **111 seconds**, 10% of the reference
words placed, and a reported `referenceCoverage` of **1.00**. Every individual rule behaved as
designed; the composition was what failed.

### The order now

| Stage | Decides | Cannot decide |
|---|---|---|
| Decode + corpus search | which words, and where the reciter went back | when anything was said |
| One global forced alignment | when every word was said | which words |
| Grouping | where a line breaks | either of the above |

Three things keep stage 1 from repeating the failure. A read-out that carries no position of
its own may **continue** the reading but never relocate it (`carries_position`). The search
keys its state on the boundary *and* the reference position, so routes that are behind on score
but ahead on truth stay alive to be compared at the end, where the honest route explains ~170
words against the poisoned one's ~70. And nothing downstream reads assignment *times* any more,
so there is no gap-filling pass left to hand a segment two minutes it never earned.

Measured against per-ayah ground truth on that same 220s passage, the single alignment placed
**all 177 words**, monotonic, with a mean ayah-start error of **0.48s**.

### Where a line breaks

Segments are a grouping of consecutive aligned words, so a segment can never span audio its own
words do not cover. A line ends at an ayah boundary, where the reciter went back on themselves,
at a mushaf stop mark they paused on, or at a silence too long for anything else to explain.

**The stop mark carries most of that decision, and it has to.** Neither signal available without
it can order the cases:

- **Pause length cannot.** In one clip 0.20s of quiet after `لَكُم` and 0.26s after `رِزْقًا ۚ` are
  the same pause, and only the second ends a phrase. An earlier measurement found the same thing
  from the other direction: a 1.91s pause fell *inside* a phrase that must not be split, while a
  break the reader plainly hears had only 0.56s of quiet. What separates them is where the
  sentence ends — which the mushaf annotates and the audio does not.
- **A gap in the alignment cannot, and is worse than useless.** A hole in the path means it had
  no text for those frames, which is what a repeat or a smeared word looks like. Of the twelve
  within-ayah breaks taken from alignment holes on one 250s clip, **every one landed on no
  silence at all** — several on stretches *louder* than the clip average.

So a mark needs only weak corroboration that the reciter did stop, and the word gap supplies
that. Breaking *without* a mark carries the whole decision alone, so it demands real measured
silence, and enough of it (`ALIGN_MIN_UNMARKED_PAUSE_SEC`, 0.6s) that nothing articulatory
accounts for it.

Silence is found by rank (`ALIGN_QUIET_PERCENTILE`) rather than by an absolute drop, because how
quiet a recording gets between phrases is largely a property of the room: at the same absolute
threshold two clips here yielded 28 pauses and 4, and the second was not the one that paused
less — it was the reverberant one.

Two further rules fall out of getting this wrong once each. Quiet lying wholly inside a word is
that word's own stop consonant, not a break. And silence must actually *separate* two words —
the run-out at the end of a recording is silence after the last word, not between anything, and
without that check it cut the final word off into a caption of its own.

---

## Repeated phrases

Reciters repeat themselves, and a straight-line reference cannot represent that. Linear
alignment of the clip left five gaps, and every one of them contained speech — two of them
*louder* than the file's average speech level:

| Gap | Level vs. average speech |
|---|---|
| 5.66–6.40 s | 107.5% |
| 6.98–7.92 s | 132.3% |
| 11.86–15.98 s | 96.6% |
| 43.87–45.13 s | 78.2% |
| 63.59–64.98 s | 68.3% |

That is audio the reference has no text left to explain — the signature of a repeat.

Rather than guessing, competing hypotheses are scored acoustically over the same frames, so
total path log-likelihood is directly comparable:

| Hypothesis | total logL | per frame |
|---|---|---|
| no repeat | −403.3 | −0.5079 |
| first 4 words repeated | −358.4 | −0.4514 |
| **first 5 words repeated** | **−352.2** | **−0.4436** |
| first 6 words repeated | −355.2 | −0.4473 |
| first 9 words repeated | −411.3 | −0.5180 |

The curve has a clear interior maximum at k=5 — it climbs, peaks, then falls back below the
no-repeat baseline. That *shape* is the result: a mechanical "more tokens always score better"
bias would rise monotonically. The reciter says `لَّقَدْ كَانَ لَكُمْ فِى رَسُولِ` twice.

`_fill_gaps_with_repeats` does this, and the rule it encodes comes from the recitation tradition
rather than from the signal. Reciters resume by **going back**: having stopped for breath they
repeat the last word or two before carrying on, so the resumed phrase still reads whole. That is
*ibtidā'*, and the tradition is explicit — after a pause you return far enough for the meaning to
stand.

A straight script has each word once, so the *first* utterance of the repeated words has no text
to sit on, and the words around it get stretched over that audio. **The hole is the signal, not
the silence.** The breath before a resumed phrase is often far too short to register as a pause
at all: 33:22's `قَالُوا۟` is recited twice and no dip threshold offers a boundary between the two
utterances, yet the hole between them is 1.43s wide.

Candidates are **read**, not scored acoustically — and this is where the earlier attempt went
wrong. Against the clip-wide emission these frames carry ~0.99 blank probability despite plainly
containing speech, so every candidate scores *worse than silence*: the correct `قَالُوا۟` scores
−22.6 against the null. Decoding the hole on its own emission answers the question directly,
because NeMo normalises features over whatever window it is handed.

Two details earn their keep:

- **Read from slightly before the hole.** The aligner stretches the preceding word into it and
  swallows the repeat's onset. At the hole exactly, that `قَالُوا۟` reads back `طامُوا` and matches
  nothing; 0.2s earlier it reads `قَالُوا`.
- **Score by recall of the candidate, not similarity.** A hole's read-out carries bleed from its
  neighbours. Against `كذبقل` the correct `قَالُوا۟` recalls 1.00 where plain similarity gives 0.57
  — below any threshold that also rejects the wrong candidate at 0.25.

An earlier `detect_repeats` scored candidates acoustically and by likelihood gain *per frame*, so
a one-syllable word could win a hole many times its own length; on the reference clip it filled
two holes with `عَلَيْهِ` and found no real repeat at all. It has been removed; this replaced it.

The narrower case of a reciter repeating only the *closing* words of a phrase before going on is
handled by `_extend_over_repeated_tail`, which reads the audio between one segment's last aligned
word and the next segment's first. **Its pass order is load-bearing.** Segments are made to meet
each other (`_close_gaps`) only *after* it runs: closing first leaves it half the gap to read, and
that half decodes to `وَامٌ وَاقب`, which matches nothing, where the whole gap reads `عِلَف طَهِّرًا`
and matches at once. Getting that order wrong silently dropped `أَن طَهِّرَا` from the segment that
recited it.

---

## Recitation rules the segmenter uses

Two things the audio cannot tell you, which the text and the tradition can.

### The stop marks are not interchangeable

The mushaf's marks (U+06D6–U+06DC) were all being treated as "the reciter may stop here". They do
not all mean that, and two of them mean the opposite:

| mark | name | meaning | count in the Quran |
|---|---|---|---|
| `ۙ` | lā | **do not stop** — the meaning breaks if you do | 68 |
| `ۜ` | saktah | brief pause taken **without breathing**, phrase continues | 7 |
| `ۘ` | lāzim | **compulsory** stop | 22 |
| `ۛ` | mu'ānaqa | stop at **one** of a pair, never both | 12 |
| `ۗ` | qilā (al-waqf awlā) | stopping is better | 603 |
| `ۚ` | jīm (jā'iz) | either is allowed | 1972 |
| `ۖ` | ṣalā (al-waṣl awlā) | continuing is better | 1682 |

`_stop_licence` sorts them into what the segmenter needs: `never` (lā, saktah — no line ends here
however long the silence), `always` (lāzim — the reciter always stops, so the least hesitation
confirms it), `paired` (mu'ānaqa — used at most once per pair), and `allowed` (the rest, still
needing the reciter's own pause as corroboration).

### A reciter may stop anywhere, and repeat after any stop

Stopping is not confined to the marked places, and after any stop a reciter may go back a word or
two for context. Three rules follow:

- **A repeat needs a stop before it.** Nobody says a word twice with 0.08s between the utterances
  — that is a boundary landing beside a word so both windows read it, which split a phrase in
  33:22 that should not be split. The stop counts whether it shows as a *gap* between the two or
  as *silence the aligner covered over*: on one clip `إِلَيْكَ` was stretched across a 1.42s pause,
  leaving the real repeat after it 0.08s away and looking like an artifact.
- **A silence a stretched word was laid over is still a silence.** Refusing to break inside a word
  made that same 1.42s pause disappear, swallowed into a 21-second caption.
- **A phrase can be repeated whole, with no hole to show for it.** Forced alignment must give every
  frame to some word, so where a phrase is said twice with no silence between the passes it covers
  the first by stretching one word — `كَيْدُ` held for 8.3 seconds. Length alone proves nothing,
  since madd stretches words by design; what marks a smear is that the over-long word's own audio
  reads back as a *run* of the reference. See `_phrase_said_twice`.

### What decides a break: a ghunnah is not a silence

Every break needs evidence from the recitation itself — a mark alone never ends a line, and
breaking at `فَأَتَمَّهُنَّ ۖ` on the strength of its mark stranded that word in a caption of its own.

But the audio alone cannot settle it either, and for a while that looked like an impasse. Five
junctions with known truth, measured every way available:

| junction | quietest point | quiet frames | Silero VAD | a stop? |
|---|---|---|---|---|
| `يَنتَظِرُ ۖ` → `وَمَا` | p0.1 | 43% | gap | yes |
| `وَرَسُولُهُۥ` → `وَصَدَقَ` | p1.6 | 20% | gap | yes |
| `بِكَلِمَـٰتٍ` → `فَأَتَمَّهُنَّ` | p4.4 | 11% | gap | **no** |
| `وَرَسُولُهُۥ ۚ` → `وَمَا` | p4.5 | **0%** | no gap | yes |
| `لَكُم` → `مِّنَ` | p4.8 | 16% | gap | **no** |

Nothing orders that. A real stop has *no quiet frames at all* (reverberant room), while a
junction the reciter never stopped at is quieter than one they did. Silero VAD — already in this
repo for `/transcribe` — scores 5 of 9 against known truth and agrees with the energy on all five.

**The answer was that two of those junctions are not silence at all.** A ghunnah is a nasal hum
held about two counts: quiet, flat and sustained, which is the same shape as silence to anything
measuring level. `لَكُم مِّنَ` merges two mīms into one held nasal (idghām mutamāthilain), and
`بِكَلِمَـٰتٍ فَأَتَمَّهُنَّ` hides the tanween's nūn behind one (ikhfā'). A **madd** does the same with a
vowel: `وَٱغْفِرْ لَنَآ ۖ إِنَّكَ` holds one across the join for several counts (madd munfasil) and shows
0.88s of gap without a single quiet frame in it — enough, before this, for the stop mark on `لَنَآ ۖ`
to put a caption boundary mid-phrase. In none of these did the reciter stop; they were still
saying the word.

Both are inaudible as breaks and entirely predictable from the text, so the text settles them.
`_sustained_junction` covers the ghunnah cases — a nūn sākinah or tanween before the idghām,
iqlāb and ikhfā' letters, and a mīm sākinah before `م` or `ب` — and the madd case, a madd letter
before hamza. Where the recitation itself accounts for the gap, the gap is not evidence of
hesitation and the mark has nothing to stand on, so the decision falls to measured silence with
`ALIGN_NASAL_JUNCTION_FACTOR` times the usual required. A reciter may still stop at such a join —
`نَارًا وَقُودُهَا` is a ghunnah join with 0.72s of real quiet, against 0.30s and 0.00s where they
did not — it simply is not *proven* by the gap being there.

### Trimming must not change the answer

The same passage has to segment the same way whether it is read out of a 96-second excerpt or the
308-second recording it came from. It did not, and the reason was a threshold defined as a *rank*:
p16 of frame energy sat at −18.0 dB over the whole file and −17.0 dB over the excerpt, which is
enough to move marginal decisions. The speech level barely moves between the two (−10.1 dB against
−10.0 dB), being a property of the reciter and the room rather than of how much was kept, so
silence is now measured relative to that.

Two consequences worth knowing. Quiet broken by a drawn breath is rejoined
(`ALIGN_QUIET_MERGE_SEC`) — a plain 0.88s pause came back as 24 quiet frames of 46 whose longest
unbroken run was 0.16s, and was discarded for missing 0.18s by one frame. And
`ALIGN_MIN_UNMARKED_PAUSE_SEC` is deliberately **not** tuned to its best score: 0.18 scores 11/11
on the reference clip against 0.30's 9/11, and is still wrong, because it splits `ٱلْأَنْهَـٰرُ` into
a caption of its own elsewhere and reintroduces the trim/full disagreement. Marginal decisions are
exactly where the two readings differ, so the bar is kept above them.

With that distinction the remaining rules are simple, and segment accuracy on the reference clip
is 9/11:

- a **marked** place needs only the reciter's own hesitation (`ALIGN_MIN_WAQF_PAUSE_SEC`, read
  from the alignment because a real stop in a reverberant room need not go quiet at all);
- an **unmarked** place needs measured silence (`ALIGN_MIN_UNMARKED_PAUSE_SEC`, 0.30s);
- a **repeat** after a stop ends a line wherever it happens;
- a **held nasal** raises the bar rather than lowering it.

### Detection can reach past the audio

Detection reads the passage from phrase matches, so it can include an ayah at the edge that was
never recited — on one clip it reported 2:121–125 for a recording that opens at 2:122. Alignment
settles it: an edge ayah that received no words at all was not there, and `/align` narrows its
answer accordingly rather than making the caller check by ear.

Sources for the above: [Bayan Al Quran Academy on waqf and
ibtidā'](https://bayanulquran-academy.com/waqf-and-ibtida/), [Riwaq Al Quran on stopping
rules](https://riwaqalquran.com/blog/what-are-the-rules-of-stopping-when-reading-quran/),
[Quranica on tajweed symbols](https://quranica.com/articles/tajweed-symbols-and-stop-signs/).

---

## The wrong-passage problem

Forced alignment has no way to fail loudly. Give it any text and any audio and it returns a
complete, monotonic, confident-looking timeline. A user who selects the wrong ayah range
therefore gets plausible garbage rather than an error, which is the single most important
failure mode to guard against.

### Mean acoustic score does not detect it

The obvious guard — mean per-word acoustic confidence — does not work. Measured against six
deliberately wrong ranges and one range that is merely too wide:

| Reference aligned | Ref words | `meanScore` | `referenceCoverage` |
|---|---|---|---|
| **33:21–23 (correct)** | 53 | 0.2923 | **1.00** |
| 1:1–7 Al-Fatihah | 29 | 0.1475 | 0.28 |
| 2:1–10 Al-Baqarah | 92 | 0.2077 | 0.26 |
| 36:1–12 Ya-Sin | 83 | 0.2263 | 0.07 |
| 112:1–4 Al-Ikhlas | 15 | **0.2550** | 0.60 |
| 33:1–5 (same surah) | 87 | 0.2057 | 0.07 |
| 18:60–82 Al-Kahf | 303 | 0.2086 | 0.04 |
| 33:21–30 (too wide) | 159 | 0.2923 | 0.33 |

Al-Ikhlas — an unrelated 15-word surah — reaches **87% of the correct score**. No threshold on
that column can separate the cases.

The reason is that phrase assignment scores only the words it actually placed. A wrong
reference is given *short* word ranges per phrase, and those few words still score plausibly;
the mean barely moves even as the alignment becomes meaningless.

### Reference coverage used to, and no longer can

`referenceCoverage` — how far through the supplied text phrase assignment got — separated every
case in the table above, and while assignment decided the timeline that was a structural
property rather than a tuned one: a phrase was only given reference words that explained its
frames, so a wrong reference stranded most of itself.

**That reasoning does not survive the pipeline change below.** Timing now comes from one global
forced alignment, which places every reference word by construction, so coverage reads 1.00 for
a wrong range as readily as for the right one. It is still reported, and it is now computed
honestly — distinct words that received a timestamp, rather than how far into the reference the
pipeline reached — but it is a completeness check on the sidecar, not evidence about the
passage. The old measure was actively misleading: it read **1.00 on a run that placed only 10%
of the words**, because one stray match near the end was enough to make it look complete.

### Decode agreement does

The replacement compares two *independent* readings of the same seconds: what the recogniser
freely heard there, against what the aligner placed there. It involves no corpus search, so
unlike coverage it cannot be talked into agreeing with itself.

| Clip | Reference aligned | `decodeAgreement` | `meanScore` | `referenceCoverage` |
|---|---|---|---|---|
| test.mp3 | **33:21–23 (correct)** | **0.888** | 0.696 | 1.000 |
| test.mp3 | 2:1–5 | 0.020 | 0.947 | 0.028 |
| test.mp3 | 33:1–3 (same surah) | 0.121 | 0.348 | 0.097 |
| test.mp3 | 36:1–8 | 0.035 | 0.001 | 1.000 |
| test.mp3 | 18:10–12 | 0.020 | 0.947 | 0.031 |
| test.mp3 | 33:21–22 (real subset) | 0.479 | 0.651 | 1.000 |
| test3.mp3 | **2:121–125 (correct)** | **0.873** | 0.684 | 0.824 |
| test3.mp3 | 7:40–45 | 0.010 | 0.000 | 1.000 |

Read the `meanScore` column before trusting it ever again: two wrong ranges scored **0.947**
against 0.696 for a correct one. A confident path over the wrong words is still a confident
path. And `referenceCoverage` reads 1.000 on three wrong ranges.

A reference covering only *part* of its audio lands in between (0.479) rather than at either
extreme, which is the right shape — it is not a wrong passage, just a narrow one.

The sidecar warns below 0.40 (`ALIGN_MIN_DECODE_AGREEMENT`), and separately when coverage shows
supplied text that was never recited. The check runs on the `nemo` backend only: the threshold
assumes a Quran-tuned decode, and the general Arabic model would disagree just as much with a
correct alignment. On `wav2vec2` the field is `null` and nothing guards the passage.

### What the app does with this

`needsReview` is set when the sidecar warns, and always for `gemini` (its timing is an estimate
by construction). Only `align` with a user-chosen range and clean coverage returns without a
review prompt.

---

## Provider design

| Provider | Identifies the text | Produces timing |
|---|---|---|
| `align` ("Local") | sidecar decode, or the user | forced alignment |
| `gemini` ("Online") | Gemini | Gemini (estimated) |

Two further providers were removed: `hybrid`, which had Gemini identify the range and the local
aligner time it, and `asr`, a free decode fuzzy-searched against the whole Quran. `hybrid` was
the better idea of the two — it paired each component with the question it could answer — but
both required the sidecar anyway, which is the setup cost `align` already carries, and neither
earned its share of the provider matrix. Their reasoning is preserved in the git history.

---

## Reproducing the measurements

The recitation clips these figures come from are **not in the repo** — they are large binaries
that belong to whoever is testing, and `.gitignore` excludes audio. Supply your own paths; the
ground truth in `scripts/expected_segments.txt` is specific to the 33:21–23 clip.

```bash
# forced alignment vs. free decoding
asr-service/.venv/bin/python scripts/spike_forced_align.py path/to/clip.mp3 33 21 23

# repeat-hypothesis scoring
asr-service/.venv/bin/python scripts/spike_detect_repeat.py path/to/clip.mp3

# segment-level evaluation against expected output
asr-service/.venv/bin/python scripts/eval_segments.py test.mp3 33 21 23

# the alignment rules themselves -- no audio, no model, runs in milliseconds
asr-service/.venv/bin/python scripts/test_alignment_rules.py

# segmentation faults reported against real recitations (needs the clips)
asr-service/.venv/bin/python scripts/test_reported_cases.py
```
