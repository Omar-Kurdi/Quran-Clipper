"""Discover which surah and ayahs were recited, from the audio alone.

Forced alignment needs to be told what text to align. This works that out
first, so the caller doesn't have to select a range by hand.

The load-bearing constraint is that the detected range must be **tight**, not a
safe superset. Forced alignment has to assign frames to every reference word,
so padding the range with extra ayahs doesn't add safety -- those words steal
frames from real audio and corrupt the whole alignment. Guessing too wide is
worse than guessing slightly narrow.
"""

from __future__ import annotations

import difflib
import logging
from collections import Counter
from dataclasses import asdict, dataclass

from . import corpus

log = logging.getLogger(__name__)

#: How strongly a candidate position is pulled toward the rest of the
#: recitation. Deliberately small: it is a tie-break between the Quran's
#: verbatim repetitions, not a reason to prefer a worse match.
NEARNESS_WEIGHT = 0.15

#: Trigram votes to consider for a phrase before scoring candidates properly.
MAX_CANDIDATES = 40

#: A phrase whose best match scores below this is treated as unrecognised
#: rather than forced onto the nearest text.
MIN_PHRASE_MATCH = 0.55


#: A surah needs at least this many confidently-located phrases to be treated
#: as genuinely part of the recitation. One stray phrase matching a formulaic
#: passage elsewhere (وذلك هو الفوز العظيم, إن الله سريع الحساب) is noise; a
#: real passage always contributes several.
MIN_PHRASES_PER_SURAH = 2

#: Words a phrase needs before it is allowed to introduce a *new* surah.
#: Short fragments carry no disambiguating information -- the muqatta'at (حم)
#: opening Ghafir match a dozen places in the corpus at ratio 1.00, and let
#: surahs into the reference that were never recited. Short phrases are still
#: matched, but only against surahs the substantial phrases established.
MIN_ANCHOR_WORDS = 3


@dataclass
class SurahRange:
    surah: int
    start_ayah: int
    end_ayah: int
    phrases: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DetectedRange:
    """One or more passages. A recitation is often Al-Fatihah plus a surah, or
    several surahs in sequence, so this deliberately is not a single range."""

    ranges: list[SurahRange]
    confidence: float
    matched_phrases: int
    total_phrases: int

    @property
    def surah(self) -> int:
        """Primary (largest) passage, for callers that want one label."""
        return max(self.ranges, key=lambda r: r.phrases).surah

    @property
    def start_ayah(self) -> int:
        return max(self.ranges, key=lambda r: r.phrases).start_ayah

    @property
    def end_ayah(self) -> int:
        return max(self.ranges, key=lambda r: r.phrases).end_ayah

    def to_dict(self) -> dict:
        return {
            "ranges": [r.to_dict() for r in self.ranges],
            "surah": self.surah,
            "start_ayah": self.start_ayah,
            "end_ayah": self.end_ayah,
            "confidence": self.confidence,
            "matched_phrases": self.matched_phrases,
            "total_phrases": self.total_phrases,
        }


def locate_phrase(
    decoded: str,
    skeletons: list[str],
    index: dict,
    allowed: set[int] | None = None,
    near: int | None = None,
) -> tuple[int, int, float] | None:
    """Best (start, end, score) span in the Quran for one decoded phrase.

    ``allowed`` restricts candidate positions to a set of corpus indices, used
    on the second pass so short fragments can only land inside surahs that
    substantial phrases already established.

    ``near`` breaks ties toward a corpus position the rest of the recitation
    already points at. The Quran repeats itself verbatim, so match quality
    alone cannot choose between occurrences: 2:122 is word-for-word identical
    to 2:47, and a recitation of 2:122-125 had its opening ayah placed at 2:47,
    clustered away as a stray, and left out of the reference entirely -- so its
    audio matched nothing and produced no segments at all. Being adjacent to
    the rest of the passage is the evidence that separates them.
    """
    tokens = [corpus.skeleton(token) for token in decoded.split()]
    tokens = [token for token in tokens if token]
    if not tokens:
        return None

    # Trigram voting narrows 82k positions to a few dozen worth scoring.
    votes: Counter[int] = Counter()
    for i in range(max(1, len(tokens) - corpus.NGRAM + 1)):
        key = tuple(tokens[i : i + corpus.NGRAM])
        for position in index.get(key, ()):
            # Offset back to where the phrase would start, so votes from
            # different trigrams of the same phrase land on the same position.
            votes[position - i] += 1

    if not votes:
        # Short or badly decoded phrase with no exact trigram anywhere. Fall
        # back to single-word votes rather than giving up on it.
        for i, token in enumerate(tokens):
            for position, corpus_token in enumerate(skeletons):
                if corpus_token == token:
                    votes[position - i] += 1
        if not votes:
            return None

    best: tuple[int, int, float] | None = None
    best_score = 0.0
    ranked = [candidate for candidate in votes.most_common() if allowed is None or candidate[0] in allowed]
    for start, _ in ranked[:MAX_CANDIDATES]:
        if start < 0 or start >= len(skeletons):
            continue
        end = min(len(skeletons), start + len(tokens))
        ratio = difflib.SequenceMatcher(None, tokens, skeletons[start:end]).ratio()
        # Small enough that it only ever separates near-equal matches -- a
        # genuinely better match somewhere far away still wins.
        score = ratio
        if near is not None:
            score -= NEARNESS_WEIGHT * min(abs(start - near), len(skeletons)) / max(len(skeletons), 1)
        if best is None or score > best_score:
            best, best_score = (start, end - 1, ratio), score
    return best


#: Unsupported ayahs tolerated inside one passage before it is treated as two
#: separate clusters. A reciter skipping an ayah, or a phrase the decoder failed
#: to place, leaves a small hole that should not split the range; nine empty
#: ayahs between one stray match and the body of the recitation should.
MAX_AYAH_GAP = 2


def _dominant_span(ayahs: list[int]) -> dict[str, int]:
    """The ayah span actually being recited, ignoring isolated stray matches.

    `ayahs` holds one entry per matched *word*, so an ayah's entry count is how
    much evidence supports it. Taking a plain min()/max() over that made the
    reported range only as good as its single worst match: on the reference clip
    a three-token fragment (`...ٱللَّهُ وَرَسُولُهُۥ`) truncated at a phrase boundary
    scored 0.67 against 33:12 -- those words genuinely appear in both 33:12 and
    33:22 -- and that one hit widened a correct 33:21-23 detection to 33:12-23,
    outvoting ten confident matches.

    Clustering instead of trimming by score keeps this free of tuned thresholds:
    contiguous runs of supported ayahs are grouped, and the group carrying the
    most matched words wins. A genuinely disjoint recitation from the same surah
    is the one case this narrows, and that is the rarer reading by a wide margin
    than a single mislocated fragment.
    """
    counts = Counter(ayahs)
    ordered = sorted(counts)

    clusters: list[list[int]] = [[ordered[0]]]
    for ayah in ordered[1:]:
        if ayah - clusters[-1][-1] - 1 > MAX_AYAH_GAP:
            clusters.append([ayah])
        else:
            clusters[-1].append(ayah)

    best = max(clusters, key=lambda cluster: sum(counts[a] for a in cluster))
    if len(clusters) > 1:
        dropped = [a for cluster in clusters if cluster is not best for a in cluster]
        log.info(
            "ignoring %d stray ayah match(es) outside the main span %d-%d: %s",
            sum(counts[a] for a in dropped),
            best[0],
            best[-1],
            dropped,
        )
    return {"start_ayah": best[0], "end_ayah": best[-1]}


def detect_range(decoded_phrases: list[str]) -> DetectedRange | None:
    """Work out the surah and ayah range covering the recited phrases.

    Each phrase is located independently and the results are pooled, rather
    than matching the whole transcript as one contiguous block. That is what
    makes repeats harmless: a phrase recited twice simply lands on the same
    corpus position twice, instead of derailing a single-span match.
    """
    words = corpus.load_words()
    skeletons = corpus.corpus_skeletons()
    index = corpus.ngram_index()

    def surah_at(position: int) -> int:
        return int(words[position][0].split(":")[0])

    # Pass 1 -- only substantial phrases, and only they may introduce a surah.
    anchors: list[tuple[int, int, float]] = []
    for decoded in decoded_phrases:
        if len(decoded.split()) < MIN_ANCHOR_WORDS:
            continue
        located = locate_phrase(decoded, skeletons, index)
        if located and located[2] >= MIN_PHRASE_MATCH:
            anchors.append(located)

    anchor_surahs: Counter[int] = Counter()
    for start, end, _ in anchors:
        for surah in {surah_at(p) for p in range(start, end + 1)}:
            anchor_surahs[surah] += 1
    established = {surah for surah, count in anchor_surahs.items() if count >= MIN_PHRASES_PER_SURAH}

    if not established:
        # Nothing substantial enough to anchor on; fall back to whatever the
        # anchors alone suggest rather than letting fragments decide.
        established = set(anchor_surahs)
    if not established:
        return None

    allowed = {p for p in range(len(words)) if surah_at(p) in established}
    log.info("anchored on surah(s) %s", ", ".join(str(s) for s in sorted(established)))

    # Where pass 1 believes the recitation sits, for pass 2 to gravitate toward.
    # The median rather than the mean, so one mislocated anchor cannot drag it.
    centre = None
    if anchors:
        centres = sorted((start + end) // 2 for start, end, _ in anchors)
        centre = centres[len(centres) // 2]

    # Pass 2 -- place every phrase, including short ones, inside those surahs.
    hits: list[tuple[int, int, float]] = []
    for decoded in decoded_phrases:
        located = locate_phrase(decoded, skeletons, index, allowed, near=centre)
        if located and located[2] >= MIN_PHRASE_MATCH:
            hits.append(located)
            log.info("phrase located at %s (%.2f): %r", words[located[0]][0], located[2], decoded[:48])
        else:
            log.info(
                "phrase not confidently located (%s): %r",
                f"{located[2]:.2f}" if located else "no match",
                decoded[:48],
            )

    if not hits:
        return None

    # Group by surah and keep every surah with real support, not just the
    # winner. Recitations routinely open with Al-Fatihah before the main
    # passage; collapsing to one surah drops those phrases, and they then get
    # force-matched into the surviving surah as nonsense.
    #
    # Within a surah the span comes from `_dominant_span` rather than plain
    # min()/max(), because a single stray phrase must not be able to stretch it.
    per_surah: dict[int, list[int]] = {}
    phrases_per_surah: Counter[int] = Counter()
    for start, end, _ in hits:
        surahs_here = {int(words[p][0].split(":")[0]) for p in range(start, end + 1)}
        for surah in surahs_here:
            phrases_per_surah[surah] += 1
            ayahs = per_surah.setdefault(surah, [])
            for position in range(start, end + 1):
                key = words[position][0].split(":")
                if int(key[0]) == surah:
                    ayahs.append(int(key[1]))

    ranges = [
        SurahRange(surah=surah, **_dominant_span(ayahs), phrases=phrases_per_surah[surah])
        for surah, ayahs in sorted(per_surah.items())
        if phrases_per_surah[surah] >= MIN_PHRASES_PER_SURAH
    ]
    if not ranges:
        return None

    kept = sum(r.phrases for r in ranges)
    confidence = sum(score for _, _, score in hits) / len(hits)

    log.info(
        "detected %s from %d/%d phrases (confidence %.2f)",
        ", ".join(f"{r.surah}:{r.start_ayah}-{r.end_ayah}" for r in ranges),
        len(hits),
        len(decoded_phrases),
        confidence,
    )
    return DetectedRange(
        ranges=ranges,
        confidence=round(confidence, 4),
        matched_phrases=min(kept, len(hits)),
        total_phrases=len(decoded_phrases),
    )
