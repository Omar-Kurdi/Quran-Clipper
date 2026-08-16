"""Silero VAD wrapper.

Produces voiced regions of the recitation. The gaps between them are the
natural pauses/breaths a reciter takes, which is exactly where we want the
on-screen text to change.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .audio import SAMPLE_RATE

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class VoicedRegion:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@lru_cache(maxsize=1)
def _load_model():
    from silero_vad import load_silero_vad

    log.info("loading silero-vad")
    return load_silero_vad()


def detect_voiced_regions(
    pcm: np.ndarray,
    *,
    threshold: float = 0.3,
    min_silence_ms: int = 900,
    min_speech_ms: int = 250,
    speech_pad_ms: int = 200,
) -> list[VoicedRegion]:
    """Return voiced spans in seconds.

    ``min_silence_ms`` is the knob that decides what counts as a "meaningful
    breath". Tested empirically against real Quran recitation: smaller values
    fragment continuous recitation into many small chunks, and each
    independent decode gets less surrounding context -- this measurably
    costs real transcribed content (whole missing ayahs, dropped clauses),
    not just extra silence-splitting. 900ms recovers most of that; going
    further (merging an entire clip into one region) can recover even more,
    with no observed quality loss up to ~70s clips, but hasn't been tested on
    much longer recordings, so it isn't the hardcoded default -- pass a
    higher value per-request if your audio has no real pause under that
    duration and you want maximum context.

    ``speech_pad_ms`` pads each detected region on both sides, so a chunk
    boundary doesn't land mid-word and clip its onset/decay.
    """
    import torch
    from silero_vad import get_speech_timestamps

    if len(pcm) == 0:
        return []

    model = _load_model()
    timestamps = get_speech_timestamps(
        torch.from_numpy(pcm),
        model,
        sampling_rate=SAMPLE_RATE,
        threshold=threshold,
        min_silence_duration_ms=min_silence_ms,
        min_speech_duration_ms=min_speech_ms,
        speech_pad_ms=speech_pad_ms,
        return_seconds=True,
    )

    regions = [VoicedRegion(float(t["start"]), float(t["end"])) for t in timestamps]
    log.info("vad found %d voiced regions", len(regions))
    return regions
