# Reciter timing tools

How `src/lib/qulCorrections.json` and `src/lib/measuredRegions.json` were made, and how to make them again when a
QUL export or a recording changes. The reasoning is in `docs/ALIGNMENT.md`, "Built-in reciters".

They read the studio's API and the alignment sidecar, so start both first (`./start.sh`), and point the tools at them
if they are not on the defaults:

```bash
export QC_STUDIO=http://localhost:3000 QC_SIDECAR=http://127.0.0.1:8000
```

Results go to `.run/reciters/<reciter>/` (not in the repository). Each tool is resumable: what it has done it skips.
Run them with `asr-service/.venv/bin/python`.

## The one rule

**Nothing a tool moves is used until it has been listened to.** The aligner and the published timings each get some
starts wrong, and the phoneme model that referees them mishears a long first syllable and cannot tell an ayah from the
end of the one before when both say the same words. `listen.py` shows, for every move, the words that should begin
there and what the phoneme model hears there. A wrong move goes into `decisions.json` under `rejected`, with what was
heard; a start heard by ear that no tool could confirm goes under `confirmed`.

## Order, for one reciter

| Step | Tool | What it does | Hours (Jalil, 16 cores) |
|---|---|---|---|
| 1 | `starts.py <r> [surahs]` | every ayah start checked by the phoneme model; moves only earlier | ~3 |
| 2 | `second.py <r>` | starts it could not confirm: aligner + phoneme second opinion | ~1 |
| 3 | `both.py <r>` | where stretched words hide the boundary: checked both ways | ~0.5 |
| 4 | `gaps.py <r> qul` | ayahs starting well after the one before ends | minutes |
| 5 | `cascade.py <r>` | the next ayah's first reading inside a moved ayah's old span | minutes |
| 6 | `listen.py moves <r>` | **listen**; record rejections in `decisions.json` | -- |
| 7 | `labels.py <r>` | word labels vs the aligner, block by block | ~1 |
| 8 | `words.py <r>` | the aligner's own words for moved and mislabelled ayahs | ~0.5 |
| 9 | `regions.py <r> <ayah>...` | stretches read on into and gone back over; then `listen.py region` | minutes |
| 10 | `build.py <r> ...` | writes both JSON files | seconds |

Steps 1-3 and 7-8 matter for an export with Khalid al-Jalil's faults (taraweeh repeats); for the others, step 4 and
step 9 found what there was. Then run `check.py run <reciters> 15 <seed>` and the fast tier (`npm run verify`), and
listen to every flag `check.py` raises -- its independent reading is the same aligner, so most flags are its own.

`onsets.py` is the shared phoneme referee; `common.py` holds the paths and the API calls.
