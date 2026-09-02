"""Segmentation faults reported against real recitations, as pass/fail checks.

Each of these was a bug someone heard in the output and described. They are
kept as checks because they are the cases most likely to come back: every one
sits where two plausible rules disagree, so a change that looks like an
improvement elsewhere can quietly undo one of them.

Needs the four clips and a loaded model, so unlike `test_alignment_rules.py`
this is not fast. Point ROOT at wherever your copies live.

Run from the repo root:
    asr-service/.venv/bin/python scripts/test_reported_cases.py
"""
import logging, os, sys
sys.path.insert(0, "/var/home/mjaynix/Projects/QuranClipper/asr-service")
logging.basicConfig(level="ERROR")
from app import align, corpus, detect
from app.audio import decode_to_pcm
ROOT = os.getenv("QURAN_CLIPS", os.path.join(os.path.dirname(__file__), "..")) + "/"
cache={}
def segs(clip):
    if clip in cache: return cache[clip]
    pcm=decode_to_pcm(open(clip if os.path.isabs(clip) else ROOT+clip,"rb").read())
    b=align.detect_boundaries(pcm); d=align.decode_phrases(pcm,b); det=detect.detect_range(d)
    ref=[]
    for r in det.ranges: ref.extend(corpus.words_for_range(r.surah,r.start_ayah,r.end_ayah))
    cache[clip]=align.align_recitation(pcm,ref,b,d).segments
    return cache[clip]
def has(clip,key,a,b):
    return any(s.verse_key==key and s.start_word+1==a and s.end_word+1==b for s in segs(clip))
fails=[]
def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   [{detail}]"))
    if not ok: fails.append(name)

check("test5: opening runs through رِزْقًا as one caption (40:13 w1-9)",
      has("test5.mp3","40:13",1,9),
      str([(s.start_word+1,s.end_word+1) for s in segs("test5.mp3") if s.verse_key=="40:13"]))
check("test5: final caption keeps ضَلَـٰلٍ (40:25 ends at w19)",
      any(s.verse_key=="40:25" and s.end_word+1==19 for s in segs("test5.mp3")))
check("test3: فَأَتَمَّهُنَّ is not stranded alone (2:124 w1-6 together)",
      has("test3.mp3","2:124",1,6),
      str([(s.start_word+1,s.end_word+1) for s in segs("test3.mp3") if s.verse_key=="2:124"]))
check("test3: أَن طَهِّرَا kept by the caption that recited it (2:125 w12-17)",
      has("test3.mp3","2:125",12,17),
      str([(s.start_word+1,s.end_word+1) for s in segs("test3.mp3") if s.verse_key=="2:125"]))
t4=segs("test4.mp3")
check("test4: the 1.42s pause ends a caption (a cut near 13.6s)",
      any(abs(s.end-13.6)<1.0 for s in t4[:-1]),
      str([round(s.end,2) for s in t4]))
check("test4: not swallowed into one long caption (>=6 segments)", len(t4)>=6, f"{len(t4)} segments")
# test_this.mp3, trimmed to 2:03-3:39. Reported against that excerpt, and the
# same passage read out of the untrimmed file must segment identically -- how
# much audio surrounds a passage cannot change where it splits.
import subprocess, tempfile  # noqa: E402
source = ROOT + "test_this.mp3"
if os.path.exists(source):
    trimmed = os.path.join(tempfile.gettempdir(), "quranclipper_test_this_2m03_3m39.mp3")
    if not os.path.exists(trimmed):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "123", "-to", "219",
                        "-i", source, "-c", "copy", trimmed], check=True)
    cut = segs(trimmed)
    full = segs(source)
    def ranges(ss, key):
        return [(s.start_word + 1, s.end_word + 1) for s in ss if s.verse_key == key]
    check(
        "test_this: نَارًا ends a caption, وَقُودُهَا starts the next (66:6 w1-7, w8-10)",
        (1, 7) in ranges(cut, "66:6") and (8, 10) in ranges(cut, "66:6"),
        str(ranges(cut, "66:6")),
    )
    check(
        "test_this: the pause after وَبِأَيْمَـٰنِهِمْ ends a caption (66:8 w29-33)",
        (29, 33) in ranges(cut, "66:8"),
        str(ranges(cut, "66:8")),
    )
    check(
        "test_this: وَٱغْفِرْ لَنَآ ۖ does not, its madd is not a stop (66:8 w34-45)",
        (34, 45) in ranges(cut, "66:8"),
        str(ranges(cut, "66:8")),
    )
    check(
        "test_this: trimming the file does not change how the passage splits",
        all(ranges(cut, k) == ranges(full, k) for k in ("66:6", "66:7", "66:8")),
        " | ".join(f"{k}: cut {ranges(cut,k)} vs full {ranges(full,k)}" for k in ("66:6", "66:7", "66:8")),
    )
else:
    print("  SKIP  test_this.mp3 not found")

print(f"\n{'FAILED: '+', '.join(fails) if fails else 'all reported cases pass'}")
sys.exit(1 if fails else 0)
