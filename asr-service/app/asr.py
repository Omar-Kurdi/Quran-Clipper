"""Word-level Arabic ASR backends.

Three interchangeable backends, all returning the same ``TimedWord`` list:

``wav2vec2`` (default)
    A CTC model decoded with character offsets. CTC frames map 1:1 onto audio
    time, so word timestamps fall out of the decode for free with no separate
    forced aligner. Ungated and small enough to run on CPU.

``nemo``
    NVIDIA NeMo FastConformer hybrid CTC/RNNT, e.g. the Quran-specific
    ``Muno459/fastconformer-quran``. Native word timestamps, best accuracy on
    recitation, but a heavy dependency and the Quran checkpoint is gated on
    the Hub (accept the terms on the model page, then `hf auth login` --
    `huggingface-cli login` was renamed to `hf auth login` and removed in
    huggingface_hub v1.0+). See asr-service/README.md for the full steps.

    Muno459/fastconformer-quran's repo root has loose/unpacked files for
    inspection (tajweed/, demo/, onnx/, tokenizer.model, model_config.yaml)
    that don't load correctly via `from_pretrained()` -- the actual packaged
    checkpoint is at `nemo/fastconformer-quran.nemo` inside the repo, which
    is what `_load_nemo()` downloads and loads directly for this model.

    ASR_NEMO_DECODER picks which of the hybrid model's two decoder heads
    produces output (`rnnt` default, or `ctc`) -- see
    `_apply_nemo_decoder_type()` and asr-service/README.md for the tradeoffs
    found testing both against real recitation; it's a genuine tradeoff, not
    a strict upgrade either direction.

``whisper``
    A Whisper encoder-decoder fine-tuned on Quranic recitation (default
    `tarteel-ai/whisper-base-ar-quran`, Tarteel AI's own official small
    model, trained on their everyayah dataset -- same data lineage NeMo's
    checkpoint used, different architecture). Whisper decodes with full
    attention over its context window rather than NeMo's RNNT
    frame-synchronous emission, so it isn't subject to the specific "skip a
    word right after a pause" pattern observed with the nemo/rnnt backend.
    Untested against that specific failure mode in this project so far --
    worth A/B testing directly against nemo on the same clip. Uses
    `transformers`, already a dependency for wav2vec2, so no new heavy
    install like nemo_toolkit.

    Word-level timestamps for Whisper are extracted via cross-attention
    weights (stored across every decoder layer/head/generated token), which
    scales up fast with model size -- `large-v3` OOM'd outright on a 16GB
    GPU requesting word timestamps, well before running out of memory for
    the weights alone. `base` is the default specifically to stay well clear
    of that. If you want to try a bigger checkpoint (e.g.
    `IJyad/whisper-large-v3-Tarteel`) via ASR_MODEL, expect to need
    meaningfully more VRAM than the weight size alone suggests.
"""

from __future__ import annotations

import logging
import os
from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np

from .audio import SAMPLE_RATE

log = logging.getLogger(__name__)

DEFAULT_WAV2VEC2_MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-arabic"
DEFAULT_NEMO_MODEL = "Muno459/fastconformer-quran"
DEFAULT_WHISPER_MODEL = "tarteel-ai/whisper-base-ar-quran"


@dataclass
class TimedWord:
    text: str
    start: float
    end: float
    score: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


class AsrError(RuntimeError):
    pass


def backend_name() -> str:
    return (os.getenv("ASR_BACKEND") or "wav2vec2").strip().lower()


def model_name() -> str:
    explicit = (os.getenv("ASR_MODEL") or "").strip()
    if explicit:
        return explicit
    backend = backend_name()
    if backend == "nemo":
        return DEFAULT_NEMO_MODEL
    if backend == "whisper":
        return DEFAULT_WHISPER_MODEL
    return DEFAULT_WAV2VEC2_MODEL


def nemo_decoder_type() -> str:
    """``rnnt`` (default) or ``ctc`` -- which branch of the hybrid model produces
    output. See `_apply_nemo_decoder_type()` for why this matters."""
    value = (os.getenv("ASR_NEMO_DECODER") or "rnnt").strip().lower()
    return value if value in ("rnnt", "ctc") else "rnnt"


# Tracks which decoder actually ended up active, which can differ from
# nemo_decoder_type() if a requested CTC switch failed and fell back to RNNT --
# see _apply_nemo_decoder_type(). None until the nemo model has been loaded.
_active_nemo_decoder: str | None = None


def active_nemo_decoder() -> str | None:
    return _active_nemo_decoder


def _device() -> str:
    import torch

    configured = (os.getenv("ASR_DEVICE") or "auto").strip().lower()
    if configured != "auto":
        return configured
    return "cuda" if torch.cuda.is_available() else "cpu"


# --------------------------------------------------------------------------
# wav2vec2 CTC
# --------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _load_wav2vec2():
    import torch
    from transformers import AutoModelForCTC, AutoProcessor

    name = model_name()
    device = _device()
    log.info("loading wav2vec2 model=%s device=%s", name, device)

    processor = AutoProcessor.from_pretrained(name)
    model = AutoModelForCTC.from_pretrained(name).to(device).eval()
    if device == "cuda":
        model = model.half()
    torch.set_grad_enabled(False)
    return processor, model, device


def _transcribe_wav2vec2(pcm: np.ndarray, offset: float) -> list[TimedWord]:
    import torch

    processor, model, device = _load_wav2vec2()

    inputs = processor(pcm, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    values = inputs.input_values.to(device)
    if device == "cuda":
        values = values.half()

    with torch.inference_mode():
        logits = model(values).logits

    log_probs = torch.log_softmax(logits.float(), dim=-1)
    confidences, predicted_ids = log_probs.max(dim=-1)

    # Seconds represented by one CTC output frame.
    frame_seconds = len(pcm) / SAMPLE_RATE / logits.shape[1]

    decoded = processor.tokenizer.decode(
        predicted_ids[0].tolist(),
        output_char_offsets=True,
    )
    char_offsets = decoded.char_offsets or []
    frame_scores = confidences[0].tolist()

    words: list[TimedWord] = []
    buffer: list[str] = []
    word_start: float | None = None
    word_end: float = 0.0
    word_scores: list[float] = []

    def flush() -> None:
        nonlocal buffer, word_start, word_end, word_scores
        text = "".join(buffer).strip()
        if text and word_start is not None:
            mean_logprob = sum(word_scores) / len(word_scores) if word_scores else -5.0
            words.append(
                TimedWord(
                    text=text,
                    start=round(offset + word_start, 3),
                    end=round(offset + max(word_end, word_start + 0.02), 3),
                    score=round(float(np.exp(mean_logprob)), 4),
                )
            )
        buffer = []
        word_start = None
        word_scores = []

    for item in char_offsets:
        char = item.get("char", "")
        start_frame = int(item.get("start_offset", 0))
        end_frame = int(item.get("end_offset", start_frame + 1))

        if char.isspace() or char == processor.tokenizer.word_delimiter_token:
            flush()
            continue

        if word_start is None:
            word_start = start_frame * frame_seconds
        word_end = end_frame * frame_seconds
        buffer.append(char)
        word_scores.extend(frame_scores[start_frame:end_frame] or [-5.0])

    flush()
    return words


# --------------------------------------------------------------------------
# NeMo FastConformer
# --------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _load_nemo():
    try:
        import nemo.collections.asr as nemo_asr
    # Not just ImportError: NeMo's own dependencies (onnx, protobuf, hydra,
    # pytorch-lightning) raise their own exception types when they disagree with
    # each other, and those would otherwise escape as a raw 500.
    except Exception as exc:  # pragma: no cover - optional heavy dep
        raise AsrError(
            f"The nemo backend could not be loaded ({type(exc).__name__}: {exc}). "
            "It needs `pip install nemo_toolkit[asr]` and a consistent onnx/protobuf pairing -- "
            "a common cause is running the service outside asr-service/.venv. "
            "Or switch to ASR_BACKEND=wav2vec2."
        ) from exc

    name = model_name()
    log.info("loading nemo model=%s", name)

    if name == DEFAULT_NEMO_MODEL:
        # Muno459/fastconformer-quran's Hub repo has the loose/unpacked contents
        # of the checkpoint at the repo root (tajweed/, demo/, onnx/, head/,
        # tokenizer.model, model_config.yaml, ...) for inspection, but it also
        # ships the actual properly-packaged .nemo archive at nemo/<name>.nemo.
        # That's the one to load directly -- it already has its artifacts
        # correctly hash-named internally, no patching needed.
        from huggingface_hub import hf_hub_download

        restore_path = hf_hub_download(repo_id=DEFAULT_NEMO_MODEL, filename="nemo/fastconformer-quran.nemo")
        model = nemo_asr.models.ASRModel.restore_from(restore_path=restore_path, map_location=_device())
    else:
        model = nemo_asr.models.ASRModel.from_pretrained(model_name=name)

    model.eval()
    _apply_nemo_decoder_type(model)
    return model


def _apply_nemo_decoder_type(model) -> None:
    """Switches which branch of this hybrid RNNT/CTC model produces output.

    RNNT (the default) decodes by choosing when to advance through the audio
    one blank/non-blank token at a time -- a known RNNT failure mode is
    occasionally skipping a stretch of audio right after a pause/breath
    within otherwise-continuous speech, distinct from any VAD/chunking issue
    (observed on real recitation even with the whole clip as a single
    region). CTC instead computes one output per fixed time frame, forcing a
    monotonic frame-by-frame alignment that structurally can't skip ahead
    the same way -- worth trying as a fix for that specific failure pattern.

    Both decoders expose word timestamps through the same
    ``hypothesis.timestamp['word']`` interface, so nothing downstream needs
    to change based on which one is active. Set ASR_NEMO_DECODER=ctc to try
    it; defaults to rnnt (NeMo's own default, and the better-tested path).

    Hybrid-model CTC timestamp decoding has had real compatibility issues on
    some NeMo versions/checkpoints (e.g. NVIDIA-NeMo/Speech#12799), so this
    is wrapped defensively: any failure logs a full traceback and leaves the
    model on RNNT rather than taking the whole service down.
    """
    decoder_type = nemo_decoder_type()
    global _active_nemo_decoder

    if decoder_type == "rnnt":
        log.info("nemo hybrid model using RNNT decoding branch (default)")
        _active_nemo_decoder = "rnnt"
        return

    try:
        import copy

        from omegaconf import open_dict

        ctc_decoding_cfg = copy.deepcopy(model.cfg.aux_ctc.decoding)
        with open_dict(ctc_decoding_cfg):
            ctc_decoding_cfg.compute_timestamps = True
            ctc_decoding_cfg.preserve_alignments = True
            # NeMo's own startup log flags 'greedy' as slower than 'greedy_batch' for the
            # exact same decoding interface -- free performance, no quality difference per
            # that message. Doesn't address the garbled-token issue seen in testing (see
            # asr-service/README.md); that appears to be inherent to this decoding path.
            ctc_decoding_cfg.strategy = "greedy_batch"
        model.change_decoding_strategy(ctc_decoding_cfg, decoder_type="ctc")
        log.info("nemo hybrid model switched to CTC decoding branch (ASR_NEMO_DECODER=ctc)")
        _active_nemo_decoder = "ctc"
    except Exception:
        log.exception(
            "failed to switch nemo hybrid model to CTC decoding (ASR_NEMO_DECODER=ctc) -- "
            "staying on RNNT. This is a known compatibility issue on some NeMo "
            "versions/checkpoints; see NVIDIA-NeMo/Speech#12799."
        )
        _active_nemo_decoder = "rnnt"


def _transcribe_nemo(pcm: np.ndarray, offset: float) -> list[TimedWord]:
    import soundfile as sf
    import tempfile

    model = _load_nemo()

    with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
        sf.write(handle.name, pcm, SAMPLE_RATE)
        results = model.transcribe([handle.name], timestamps=True)

    hypotheses = results[0] if isinstance(results, tuple) else results
    hypothesis = hypotheses[0]
    stamps = (getattr(hypothesis, "timestamp", None) or {}).get("word", [])

    words: list[TimedWord] = []
    for stamp in stamps:
        text = str(stamp.get("word", "")).strip()
        if not text:
            continue
        words.append(
            TimedWord(
                text=text,
                start=round(offset + float(stamp.get("start", 0.0)), 3),
                end=round(offset + float(stamp.get("end", 0.0)), 3),
                score=float(stamp.get("score", 0.8) or 0.8),
            )
        )

    # The hybrid RNNT/CTC decode can produce a full recognized `hypothesis.text`
    # string without a matching entry in `timestamp['word']` for every word it
    # actually recognized -- silently returning fewer words than the model
    # really decoded. If that happens here, recover the missing words by
    # evenly spreading the full recognized text across this chunk's duration,
    # rather than dropping real, decoded words entirely. The log line below is
    # the diagnostic: if it never fires, the model genuinely isn't recognizing
    # that audio (a VAD/chunking or acoustic issue, not a timestamp bug); if it
    # does fire with real missing words, this was the cause.
    full_text = str(getattr(hypothesis, "text", "") or "").strip()
    text_words = full_text.split()
    if len(text_words) > len(words):
        log.warning(
            "nemo timestamp['word'] returned %d word(s) but hypothesis.text has %d word(s) "
            "for a %.2fs chunk at offset %.2fs -- falling back to evenly-spaced timestamps. "
            "Recognized text: %r",
            len(words),
            len(text_words),
            len(pcm) / SAMPLE_RATE,
            offset,
            full_text,
        )
        chunk_duration = len(pcm) / SAMPLE_RATE
        step = chunk_duration / max(len(text_words), 1)
        words = [
            TimedWord(
                text=w,
                start=round(offset + i * step, 3),
                end=round(offset + (i + 1) * step, 3),
                # Lower confidence -- these timestamps are estimated (evenly spread), not
                # individually decoded, so downstream alignment should trust them less.
                score=0.5,
            )
            for i, w in enumerate(text_words)
        ]

    return words


# --------------------------------------------------------------------------
# Whisper (Tarteel-fine-tuned)
# --------------------------------------------------------------------------


_WHISPER_SIZE_KEYWORDS = ["large-v3", "large-v2", "large-v1", "large", "medium", "small", "base", "tiny"]


def _infer_whisper_base_config_id(name: str) -> str:
    """Guesses which official openai/whisper-* size a fine-tune's name implies, so a
    complete, known-good generation_config can be borrowed from it. Fine-tuning doesn't
    normally change Whisper's tokenizer/vocab/architecture, so the base size's config is
    safe to reuse wholesale -- it's the checkpoint's own weights that differ, not the
    generation machinery around them."""
    lowered = name.lower()
    for size in _WHISPER_SIZE_KEYWORDS:
        if size in lowered:
            return f"openai/whisper-{size}"
    return "openai/whisper-base"


@lru_cache(maxsize=1)
def _load_whisper():
    import torch
    from transformers import GenerationConfig, pipeline

    name = model_name()
    device = _device()
    log.info("loading whisper model=%s device=%s", name, device)

    torch_dtype = torch.float16 if device == "cuda" else torch.float32
    asr_pipeline = pipeline(
        "automatic-speech-recognition",
        model=name,
        device=device,
        torch_dtype=torch_dtype,
        # Deliberately NOT setting chunk_length_s: transformers logs it as "very
        # experimental with seq2seq models" and recommends relying on Whisper's own
        # built-in long-form generation instead, which activates automatically for
        # input over Whisper's 30s native context without needing this. Relevant here
        # since a single VAD region can legitimately exceed 30s (see the nemo backend's
        # notes on min_silence_ms -- less pre-chunking measurably helped there too).
    )

    # Some Whisper fine-tunes (e.g. tarteel-ai/whisper-base-ar-quran) don't ship a
    # generation_config.json at all, and word-level return_timestamps + explicit
    # language/task selection both hard-require several fields on it (no_timestamps_
    # token_id, lang_to_id, task_to_id, ...) -- without them generate() raises a
    # ValueError before producing any output. Patching individual fields as each one's
    # absence surfaces a new error is a losing game; replace the whole config with a
    # complete, known-good one from the matching official openai/whisper-* size instead.
    gen_cfg = asr_pipeline.model.generation_config
    looks_incomplete = getattr(gen_cfg, "no_timestamps_token_id", None) is None or getattr(gen_cfg, "lang_to_id", None) is None
    if looks_incomplete:
        base_config_id = _infer_whisper_base_config_id(name)
        try:
            asr_pipeline.model.generation_config = GenerationConfig.from_pretrained(base_config_id)
            log.info(
                "replaced incomplete/missing whisper generation_config with %s's (checkpoint didn't ship a usable one)",
                base_config_id,
            )
        except Exception:
            log.exception(
                "failed to load a complete generation_config from %s -- word timestamps and/or "
                "language selection will likely still fail on this model.",
                base_config_id,
            )

    return asr_pipeline


def _transcribe_whisper(pcm: np.ndarray, offset: float) -> list[TimedWord]:
    pipe = _load_whisper()

    result = pipe(
        {"array": pcm, "sampling_rate": SAMPLE_RATE},
        return_timestamps="word",
        generate_kwargs={"language": "arabic", "task": "transcribe"},
    )

    words: list[TimedWord] = []
    for chunk in result.get("chunks", []) or []:
        text = str(chunk.get("text", "")).strip()
        if not text:
            continue
        timestamp = chunk.get("timestamp") or (None, None)
        start, end = timestamp if isinstance(timestamp, (list, tuple)) and len(timestamp) == 2 else (None, None)
        if start is None:
            continue
        if end is None:
            # Whisper occasionally leaves the final chunk's end unset; estimate rather
            # than drop a word we did actually recognize.
            end = start + 0.3

        words.append(
            TimedWord(
                text=text,
                start=round(offset + float(start), 3),
                end=round(offset + float(end), 3),
                # Whisper's word-timestamp output doesn't include a per-word confidence
                # score the way the CTC/RNNT decoders do -- neutral default.
                score=0.75,
            )
        )
    return words


# --------------------------------------------------------------------------


def transcribe_words(pcm: np.ndarray, offset: float = 0.0) -> list[TimedWord]:
    """Transcribe one voiced chunk, returning absolute-time word stamps."""
    if len(pcm) < SAMPLE_RATE // 20:  # < 50 ms is noise
        return []

    backend = backend_name()
    if backend == "nemo":
        return _transcribe_nemo(pcm, offset)
    if backend == "wav2vec2":
        return _transcribe_wav2vec2(pcm, offset)
    if backend == "whisper":
        return _transcribe_whisper(pcm, offset)
    raise AsrError(f"Unknown ASR_BACKEND '{backend}'. Use 'wav2vec2', 'nemo', or 'whisper'.")


def warm_up() -> None:
    """Preload weights so the first real request is not slow."""
    try:
        backend = backend_name()
        if backend == "nemo":
            _load_nemo()
        elif backend == "whisper":
            _load_whisper()
        else:
            _load_wav2vec2()
    except Exception:  # pragma: no cover - warm-up is best effort
        log.exception("ASR warm-up failed; the model will load on first request")
