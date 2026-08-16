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

This is the mechanism the shipped repeat detection uses: for each unexplained gap, score
candidate runs of nearby reference text against only that gap's frames, with "these frames are
blank" as the null hypothesis. Scoring must stay local — across a whole clip the tens of nats
separating a real repeat are swamped by the thousands in the rest of the path.

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

### Reference coverage does

`referenceCoverage` — how far through the supplied text the phrase assignment actually got —
separates every case completely. It works for a structural reason rather than a tuned one:
each phrase is only assigned reference words that explain its frames, so a correct reference
gets walked to its end and a wrong one strands most of itself. It is also close to scale-free,
unlike a score or a words-per-second rate, so it does not move with reciter speed or clip
length.

The sidecar raises a warning below 75% coverage (`ALIGN_MIN_REFERENCE_COVERAGE`), and the app
turns that into a review prompt.

Two caveats worth knowing:

- **Validated on one clip.** The separation above is total here, but on much longer audio the
  phrase beam search may legitimately fail to walk a several-hundred-word reference to its end.
  If coverage warnings appear on recitations you know are correct, raise the threshold before
  concluding the alignment is wrong.
- **Multi-block references are the fragile case.** A reference built from more than one block
  is concatenated and walked with a forward cursor from word 0. If the *first* block isn't
  actually in the audio, the search may never escape it. Coverage catches this, but the
  resulting timeline is unusable rather than merely padded — prefer one tight range when known.

### What the app does with this

`needsReview` is set when coverage warns, always for `hybrid` (an LLM chose the range, and
coverage cannot catch a near-miss such as 21–24 identified as 21–23), and always for `gemini`
(its timing is an estimate by construction). Only `align` with a user-chosen range and clean
coverage returns without a review prompt.

---

## Provider design

| Provider | Identifies the text | Produces timing |
|---|---|---|
| `align` | sidecar decode, or the user | forced alignment |
| `hybrid` | Gemini | forced alignment |
| `gemini` | Gemini | Gemini (estimated) |
| `asr` | free decode + corpus search | free decode |

`hybrid` exists because the two halves of the problem have different best answers. Identifying
"this is Al-Ahzab 33:21–23" is pattern recognition over a known corpus, which a large
multimodal model does well. Placing word boundaries to the centisecond is frame-level acoustic
work, which it cannot do at all. Asking each component only the question it can answer gives
exact timing without requiring the user to know the passage in advance.

`asr` is retained for comparison and for the case where neither a range nor an API key is
available. Its reliability is low for the reasons in the first section, and it is not
recommended.

---

## Reproducing the measurements

```bash
# forced alignment vs. free decoding
asr-service/.venv/bin/python scripts/spike_forced_align.py path/to/clip.mp3 33 21 23

# repeat-hypothesis scoring
asr-service/.venv/bin/python scripts/spike_detect_repeat.py path/to/clip.mp3

# segment-level evaluation against expected output
asr-service/.venv/bin/python scripts/eval_segments.py
```
