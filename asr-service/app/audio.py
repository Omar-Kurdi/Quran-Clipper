"""Audio decoding helpers.

Everything downstream (VAD + ASR) works on 16 kHz mono float32 PCM, so we
normalise once here via ffmpeg and keep a single numpy array in memory.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import urllib.parse

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


#: Hosts this service will fetch recitation audio from.
#:
#: Deliberately the same three the web app's `/api/audio/proxy` allows, and for
#: the same reason: fetching a caller-supplied URL server-side is a request
#: made from inside the network, so without a list this endpoint would fetch
#: anything anyone could name -- including addresses only this machine can
#: reach. Keep the two lists in step.
ALLOWED_AUDIO_HOSTS = frozenset(
    host.strip()
    for host in os.getenv(
        "ALIGN_ALLOWED_AUDIO_HOSTS",
        "download.quranicaudio.com,audio.qurancdn.com,verses.quran.com,.mp3quran.net",
    ).split(",")
    if host.strip()
)


def check_audio_url(url: str) -> str:
    """Reject a URL this service will not fetch, with the reason.

    An entry beginning with a dot matches any subdomain of it, which is there
    for mp3quran.net: the built-in reciters are spread across server6, 7, 11
    and 12, and which server hosts whom is their business to change, not a list
    to keep chasing. Everything else is an exact hostname.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise AudioDecodeError(f"Audio URLs must be https, not {parsed.scheme or 'a relative path'!r}.")
    host = parsed.hostname or ""
    allowed = host in ALLOWED_AUDIO_HOSTS or any(
        entry.startswith(".") and host.endswith(entry) for entry in ALLOWED_AUDIO_HOSTS
    )
    if not allowed:
        raise AudioDecodeError(
            f"{host!r} is not a recitation host this service fetches from. "
            f"Allowed: {', '.join(sorted(ALLOWED_AUDIO_HOSTS))}."
        )
    return url


def decode_url_window(url: str, start: float, end: float) -> np.ndarray:
    """Decode one time window of a remote recording, without downloading the rest.

    A reciter's chapter file is the *whole* chapter -- Al-Baqarah is 87 MB and
    around two hours -- while what needs aligning is a few ayahs somewhere
    inside it. ffmpeg seeks over HTTP with range requests, so this reads only
    the window: measured at 2.2s to take 30s from 600s into that 87 MB file.

    Seeking is exact, which is what makes the times usable. Measured against a
    numpy slice of the same file decoded whole: identical sample count, zero
    lag. So a word placed at t in this window is at `start + t` in the
    recording, with no drift to correct for.
    """
    ensure_ffmpeg()
    check_audio_url(url)
    if not (end > start >= 0):
        raise AudioDecodeError(f"Nonsensical audio window {start}-{end}s.")

    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            # Before -i: ffmpeg seeks the input rather than decoding and
            # discarding everything up to `start`, which is the difference
            # between a range request and downloading two hours of audio.
            "-ss", f"{start:.3f}",
            "-to", f"{end:.3f}",
            "-i", url,
            "-vn",
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
        detail = proc.stderr.decode("utf-8", errors="replace").strip()[:400]
        raise AudioDecodeError(f"Could not read {start:.1f}-{end:.1f}s from the recitation audio. {detail}")

    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
