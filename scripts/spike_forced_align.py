"""Stage B spike: CTC forced alignment of KNOWN Quran text against the audio.

No decoding. The token sequence is fixed to the Uthmani text, so the model can
only decide *when* each character was said, never *what* was said. Structurally
cannot drop, garble, or hallucinate a word.

Usage:
    python scripts/spike_forced_align.py AUDIO SURAH START_AYAH END_AYAH

    python scripts/spike_forced_align.py ~/Music/test.mp3 33 21 23

Run it with the asr-service venv:
    asr-service/.venv/bin/python scripts/spike_forced_align.py ...
"""
import json, re, subprocess, sys, urllib.request
import numpy as np
import torch
import torchaudio.functional as AF
from transformers import AutoModelForCTC, AutoProcessor

SR = 16000
MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-arabic"
AUDIO = sys.argv[1]
SURAH, START, END = (int(x) for x in sys.argv[2:5])

# ---------------------------------------------------------------- reference text
url = (f"https://api.quran.com/api/v4/verses/by_chapter/{SURAH}"
       "?language=en&words=true&fields=text_uthmani"
       "&word_fields=text_uthmani&per_page=300")
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
verses = json.load(urllib.request.urlopen(req))["verses"]
verses = [v for v in verses if START <= v["verse_number"] <= END]

ref_words = []  # (verse_key, word_index, uthmani)
for v in verses:
    wi = 0
    for w in v.get("words", []):
        if w.get("char_type_name") != "word":
            continue
        ref_words.append((v["verse_key"], wi, w["text_uthmani"]))
        wi += 1
print(f"reference: {len(ref_words)} words across {len(verses)} ayahs "
      f"({verses[0]['verse_key']}..{verses[-1]['verse_key']})")

# ------------------------------------------------- normalize Uthmani -> model vocab
DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭـ]")

def normalize(word: str) -> str:
    s = DIACRITICS.sub("", word)
    s = re.sub(r"[آأإٱ]", "ا", s)  # آأإٱ -> ا
    s = s.replace("ى", "ي")                        # ى -> ي
    return re.sub(r"[^ء-ي]", "", s)

proc = AutoProcessor.from_pretrained(MODEL)
model = AutoModelForCTC.from_pretrained(MODEL).to("cuda").eval()
vocab = proc.tokenizer.get_vocab()
blank_id = proc.tokenizer.pad_token_id
sep_id = vocab["|"]
assert blank_id == 0, f"forced_align assumes blank=0, got {blank_id}"

# target token ids + a map from each target position back to its ref word
targets, tgt2word = [], []
missing = set()
for i, (_, _, uth) in enumerate(ref_words):
    norm = normalize(uth)
    if not norm:
        continue
    if targets:                       # separator between words
        targets.append(sep_id); tgt2word.append(-1)
    for ch in norm:
        if ch not in vocab:
            missing.add(ch); continue
        targets.append(vocab[ch]); tgt2word.append(i)
if missing:
    print("!! chars missing from vocab:", missing)
else:
    print(f"vocab coverage: OK ({len(targets)} target tokens, blank={blank_id}, sep={sep_id})")

# ---------------------------------------------------------------------- emissions
raw = subprocess.run(
    ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", AUDIO,
     "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"],
    stdout=subprocess.PIPE, check=True).stdout
pcm = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
dur = len(pcm) / SR

with torch.inference_mode():
    iv = proc(pcm, sampling_rate=SR, return_tensors="pt").input_values.to("cuda")
    emission = torch.log_softmax(model(iv).logits.float(), dim=-1)
n_frames = emission.shape[1]
sec_per_frame = dur / n_frames
print(f"audio {dur:.2f}s -> {n_frames} frames ({sec_per_frame*1000:.1f} ms/frame)")

# ----------------------------------------------------------------- forced align
tgt = torch.tensor([targets], dtype=torch.int32, device=emission.device)
path, scores = AF.forced_align(emission, tgt, blank=blank_id)
path, scores = path[0].cpu().numpy(), scores[0].float().exp().cpu().numpy()

# frame path -> per-target-token frame spans
spans = {}
ti = -1
prev = blank_id
for f, tok in enumerate(path):
    if tok == blank_id:
        prev = tok
        continue
    if tok != prev or f == 0:
        ti += 1
    prev = tok
    if ti not in spans:
        spans[ti] = [f, f, []]
    spans[ti][1] = f
    spans[ti][2].append(scores[f])

# per-target-token -> per-word
words_out = []
for i, (vk, wi, uth) in enumerate(ref_words):
    pos = [p for p, w in enumerate(tgt2word) if w == i]
    fr = [spans[p] for p in pos if p in spans]
    if not fr:
        words_out.append((vk, uth, None, None, 0.0)); continue
    s = min(x[0] for x in fr) * sec_per_frame
    e = (max(x[1] for x in fr) + 1) * sec_per_frame
    conf = float(np.mean([c for x in fr for c in x[2]]))
    words_out.append((vk, uth, s, e, conf))

print("\n=== FORCED ALIGNMENT (every reference word gets a time) ===")
prev_key = None
for vk, uth, s, e, c in words_out:
    if vk != prev_key:
        print(f"\n--- {vk} ---"); prev_key = vk
    print(f"  {s:6.2f} - {e:6.2f}  conf={c:.2f}  {uth}")

covered = sum(1 for w in words_out if w[2] is not None)
print(f"\nwords placed: {covered}/{len(words_out)}")
print(f"span: {words_out[0][2]:.2f}s .. {words_out[-1][3]:.2f}s  (audio {dur:.2f}s)")
mono = all(words_out[i][2] <= words_out[i+1][2] for i in range(len(words_out)-1)
           if words_out[i][2] is not None and words_out[i+1][2] is not None)
print("monotonic:", mono)

# pause-based segmentation, straight from the word gaps
print("\n=== SEGMENTS (split where inter-word gap > 0.35s) ===")
GAP = 0.35
seg = [words_out[0]]
for prev_w, w in zip(words_out, words_out[1:]):
    if w[2] - prev_w[3] > GAP or w[0] != prev_w[0]:
        print(f"  {seg[0][2]:6.2f} - {seg[-1][3]:6.2f}  [{seg[0][0]}]  {' '.join(x[1] for x in seg)}")
        seg = []
    seg.append(w)
if seg:
    print(f"  {seg[0][2]:6.2f} - {seg[-1][3]:6.2f}  [{seg[0][0]}]  {' '.join(x[1] for x in seg)}")
