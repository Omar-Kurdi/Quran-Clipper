"""Whether the Hub has a newer upload of the alignment model than the one pinned.

The aligner loads one exact upload of `Muno459/fastconformer-quran`
(`DEFAULT_NEMO_ALIGN_REVISION` in `asr-service/app/align.py`), so a new push
to the Hub changes nothing until it is chosen. This says when there is one,
and whether the weights themselves changed or only the repo's other files --
a new README is not a new model.

Trying a newer one is a measurement, not an upgrade:

    ASR_ALIGN_MODEL_REVISION=<sha> ./gauge.sh

and the pin moves only when ground truth and the reported cases both agree.

Standard library only, and no login: the Hub answers these two questions for a
gated repo too. Exit 0 when the pin is the latest, 1 when a newer upload
exists, 2 when the Hub could not be asked.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

ALIGN = Path(__file__).resolve().parent.parent / "asr-service" / "app" / "align.py"
WEIGHTS = "nemo/fastconformer-quran.nemo"
API = "https://huggingface.co/api/models"


def pinned() -> tuple[str, str]:
    """The model and revision `align.py` pins, read from the source rather than imported (no torch needed)."""
    source = ALIGN.read_text(encoding="utf-8")
    model = re.search(r'^DEFAULT_NEMO_ALIGN_MODEL = "([^"]+)"', source, re.M)
    revision = re.search(r'^DEFAULT_NEMO_ALIGN_REVISION = "([0-9a-f]{40})"', source, re.M)
    if not model or not revision:
        raise SystemExit(f"Could not find the pinned model in {ALIGN}.")
    return model.group(1), revision.group(1)


#: What a Hub model id and a commit sha look like. The URL is built only from
#: these and the fixed Hub address, so nothing read from a file can point the
#: request anywhere else.
MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*")
COMMIT = re.compile(r"[0-9a-f]{40}")


def hub(model: str, revision: str | None = None) -> dict:
    if not MODEL_ID.fullmatch(model) or (revision is not None and not COMMIT.fullmatch(revision)):
        raise ValueError(f"not a Hub model id and commit: {model!r} {revision!r}")
    url = f"{API}/{model}" if revision is None else f"{API}/{model}/revision/{revision}?blobs=true"
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.load(response)


def weights_digest(model: str, revision: str) -> str | None:
    """The sha256 of the checkpoint file at one revision, as the Hub's LFS record gives it."""
    for sibling in hub(model, revision).get("siblings", []):
        if sibling.get("rfilename") == WEIGHTS:
            return (sibling.get("lfs") or {}).get("sha256")
    return None


def main() -> int:
    model, revision = pinned()
    try:
        latest = hub(model)
        newest = latest["sha"]
        if newest == revision:
            print(f"{model}: the pinned upload {revision[:7]} is the latest ({latest.get('lastModified', '?')[:10]}).")
            return 0
        same_weights = weights_digest(model, newest) == weights_digest(model, revision)
    except (OSError, ValueError, KeyError) as exc:
        print(f"{model}: could not ask the Hub ({type(exc).__name__}: {exc}).")
        return 2
    print(f"{model}: a newer upload exists.")
    print(f"  pinned  {revision}")
    print(f"  latest  {newest}  ({latest.get('lastModified', '?')[:10]})")
    if same_weights:
        print("  The weights are the same file; only the repo's other files changed. Nothing to measure.")
    else:
        print("  The weights changed. Measure it before moving the pin:")
        print(f"    ASR_ALIGN_MODEL_REVISION={newest} ./gauge.sh")
    return 1


if __name__ == "__main__":
    sys.exit(main())
