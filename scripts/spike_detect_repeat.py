"""Stage C spike: does the 0-16s window contain a REPEAT?

Same audio window, competing text hypotheses. Forced-align each and compare the
total Viterbi path log-likelihood. Same frames in every case, so the totals are
directly comparable: whichever text best explains the audio wins.

H_k = first k words spoken twice, then the full 9-word phrase. k=0 is "no repeat".
"""
import json, re, subprocess, urllib.request
import numpy as np
import torch
import torchaudio.functional as AF
from transformers import AutoModelForCTC, AutoProcessor

SR = 16000
MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-arabic"
WIN_START, WIN_END = 0.0, 15.9   # up to where "كَانَ" starts in the linear alignment

url = ("https://api.quran.com/api/v4/verses/by_chapter/33"
       "?language=en&words=true&fields=text_uthmani&word_fields=text_uthmani&per_page=300")
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
verses = json.load(urllib.request.urlopen(req))["verses"]
v21 = next(v for v in verses if v["verse_number"] == 21)
words21 = [w["text_uthmani"] for w in v21["words"] if w.get("char_type_name") == "word"]
phrase = words21[:9]
print("phrase:", " ".join(phrase), "\n")

DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭـ]")
def normalize(w):
    s = DIACRITICS.sub("", w)
    s = re.sub(r"[آأإٱ]", "ا", s).replace("ى", "ي")
    return re.sub(r"[^ء-ي]", "", s)

proc = AutoProcessor.from_pretrained(MODEL)
model = AutoModelForCTC.from_pretrained(MODEL).to("cuda").eval()
vocab = proc.tokenizer.get_vocab(); blank = proc.tokenizer.pad_token_id; sep = vocab["|"]

raw = subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-i",
                      "/var/home/mjaynix/Music/test.mp3","-f","s16le","-ac","1","-ar",str(SR),"pipe:1"],
                     stdout=subprocess.PIPE, check=True).stdout
pcm = np.frombuffer(raw, np.int16).astype(np.float32)/32768.0
win = pcm[int(WIN_START*SR):int(WIN_END*SR)]

with torch.inference_mode():
    iv = proc(win, sampling_rate=SR, return_tensors="pt").input_values.to("cuda")
    emission = torch.log_softmax(model(iv).logits.float(), dim=-1)
n_frames = emission.shape[1]
print(f"window {WIN_START}-{WIN_END}s -> {n_frames} frames\n")

def build(seq):
    t = []
    for w in seq:
        n = normalize(w)
        if not n: continue
        if t: t.append(sep)
        t.extend(vocab[c] for c in n if c in vocab)
    return t

print(f"{'hypothesis':<46} {'tokens':>6} {'total logL':>12} {'per-frame':>10}")
print("-" * 78)
results = []
for k in range(0, 10):
    seq = phrase[:k] + phrase
    targets = build(seq)
    tgt = torch.tensor([targets], dtype=torch.int32, device=emission.device)
    _, scores = AF.forced_align(emission, tgt, blank=blank)
    total = float(scores[0].float().sum())
    label = "no repeat (single pass)" if k == 0 else f"first {k} word(s) repeated"
    print(f"{label:<46} {len(targets):>6} {total:>12.1f} {total/n_frames:>10.4f}")
    results.append((total, k, seq))

best = max(results)
print("\nBEST:", "no repeat" if best[1] == 0 else f"first {best[1]} words repeated")
print("text:", " ".join(best[2]))
