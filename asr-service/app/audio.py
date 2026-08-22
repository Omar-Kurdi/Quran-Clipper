"""Audio decoding helpers.

Everything downstream (VAD + ASR) works on 16 kHz mono float32 PCM, so we
normalise once here via ffmpeg and keep a single numpy array in memory.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile

import numpy as np

SAMPLE_RATE = 16_000


class AudioDecodeError(RuntimeError):
    pass


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise AudioDecodeError(
            "ffmpeg was not found on PATH. Install it (apt install ffmpeg / brew install ffmpeg) "
            "so the ASR service can decode mp3/m4a uploads."
        )


def decode_to_pcm(raw: bytes) -> np.ndarray:
    """Decode arbitrary media bytes into 16 kHz mono float32 in [-1, 1].

    Accepts video containers as readily as bare audio -- ffmpeg selects the
    audio stream on its own -- so an uploaded MP4/MOV/WebM works here without
    the caller stripping the audio first.

    The bytes go through a temp file rather than a pipe because MP4/MOV keep
    their `moov` index atom at the *end* unless explicitly written faststart,
    and demuxing that requires seeking. Over `pipe:0` ffmpeg cannot seek, so
    exactly the files a phone or a camera produces fail with "moov atom not
    found". A temp file costs one write and removes that whole class of
    failure.
    """
    ensure_ffmpeg()

    with tempfile.NamedTemporaryFile(suffix=".media") as source:
        source.write(raw)
        source.flush()

        proc = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel", "error",
                "-i", source.name,
                "-vn",  # ignore any video stream; we only want the audio
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ac", "1",
                "-ar", str(SAMPLE_RATE),
                "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()[:500]
        raise AudioDecodeError(
            "ffmpeg could not decode an audio track from the upload. If this is a video file, "
            f"check that it actually contains audio. {detail}"
        )

    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return np.ascontiguousarray(pcm)


def duration_seconds(pcm: np.ndarray) -> float:
    return float(len(pcm)) / SAMPLE_RATE
