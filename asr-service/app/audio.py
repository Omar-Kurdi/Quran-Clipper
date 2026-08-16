"""Audio decoding helpers.

Everything downstream (VAD + ASR) works on 16 kHz mono float32 PCM, so we
normalise once here via ffmpeg and keep a single numpy array in memory.
"""

from __future__ import annotations

import shutil
import subprocess

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
    """Decode arbitrary compressed audio bytes into 16 kHz mono float32 in [-1, 1]."""
    ensure_ffmpeg()

    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "-ac", "1",
            "-ar", str(SAMPLE_RATE),
            "pipe:1",
        ],
        input=raw,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    if proc.returncode != 0 or not proc.stdout:
        detail = proc.stderr.decode("utf-8", errors="replace").strip()[:500]
        raise AudioDecodeError(f"ffmpeg could not decode the uploaded audio. {detail}")

    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return np.ascontiguousarray(pcm)


def duration_seconds(pcm: np.ndarray) -> float:
    return float(len(pcm)) / SAMPLE_RATE
