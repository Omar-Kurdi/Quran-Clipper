#!/usr/bin/env bash
#
# Install what ./start.sh runs, for one of two uses:
#
#   personal   the studio for you: saved projects in a database on this
#              machine, every matcher, any translation edition you hold.
#   public     a studio anyone can open: no accounts and no database --
#              each visitor's projects stay in their own browser -- one
#              alignment at a time with a visible queue, no Gemini, the
#              default translation, and HTTPS through Caddy.
#
# Safe to run again. Each step checks what is already there and skips it, so
# after a `git pull` this installs only what changed. Like ./start.sh it keeps
# going past a step it cannot do, and ends with a list of what is left for you.
#
# The steps this exists for are the ones that went wrong by hand on a fresh
# server: torch and torchaudio from different indexes (alignment then cannot
# load its library), no ffmpeg (every match fails), and a model that has to be
# downloaded from a gated repository.
#
# Usage:
#   ./install.sh                     asks personal or public (personal if it cannot ask)
#   ./install.sh --personal
#   ./install.sh --public --domain studio.example.com
#   ./install.sh ... --no-apt        do not install system packages; only report them
#   ./install.sh ... --no-recordings do not download the reciters' recordings
#
# Last, it downloads every built-in reciter's recordings (about 14 GB, half an
# hour or so the first time) into data/audio-cache/, so the studio never waits on a
# CDN or fails when one refuses. Already-kept recordings are skipped.
#
# On Debian or Ubuntu, as root or with sudo, it installs what the machine is
# missing: Node.js 22 (from NodeSource where the distribution's is too old),
# ffmpeg, Python 3.12 or 3.11 with venv (through uv where apt has neither),
# a compiler for the few Python packages built from source, and podman
# (personal) or Caddy (public).
#   HF_TOKEN=hf_... ./install.sh     log in to Hugging Face without a prompt
#                                    (otherwise it asks, and downloads the model)
#
# Not installed here, because they cannot be fetched: the mushaf fonts and the
# QUL data (downloaded from a signed-in qul.tarteel.ai account). The studio
# works without them -- the Arabic is drawn in Amiri -- and the end of the run
# says how to add them. See "Mushaf fonts and QUL data" in README.md.
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")" || exit 1

APT=1; USE=""; DOMAIN=""; RECORDINGS=1
while (( $# )); do
  case "$1" in
    --apt) APT=1 ;;  # the default now; still accepted
    --no-apt) APT="" ;;
    --personal) USE="personal" ;;
    --public) USE="public" ;;
    --domain) DOMAIN="${2:-}"; shift ;;
    --no-recordings) RECORDINGS="" ;;
    -h|--help) sed -n '2,43p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see ./install.sh --help)" >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$USE" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Personal studio, or public for anyone to use? [personal/public] " answer
    [[ "${answer,,}" == pub* ]] && USE="public" || USE="personal"
  else
    USE="personal"
  fi
fi
if [[ "$USE" == "public" && -z "$DOMAIN" && -t 0 ]]; then
  read -r -p "Domain for HTTPS (blank to set up Caddy yourself later): " DOMAIN
fi

RUN_DIR=".run"; mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/install.log"; : >"$LOG"
# Everything shown is kept too, so the end can report every step in one place.
SHOWN="$RUN_DIR/install-shown.txt"
exec 3>&1 > >(tee "$SHOWN")
TEE_PID=$!
TODO=()
todo() { TODO+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
echo "Installing a $USE studio."

# A failed step shows why here, not only in the log.
show_log_tail() { tail -n 15 "$LOG" | sed 's/^/      | /'; }

# Python 3.11 or 3.12: NeMo has no wheels for 3.13+. uv's own copy counts, for
# a distribution whose apt has neither (Ubuntu 22.04).
UV="$RUN_DIR/uv/uv"
pick_python() {
  for py in python3.12 python3.11; do have "$py" && { command -v "$py"; return; }; done
  [[ -x "$UV" ]] && "$UV" python find 3.12 2>/dev/null
}

# Whether apt can install a package at all. Asked one at a time, because one
# name with no candidate fails a whole `apt-get install` and takes ffmpeg
# down with it.
apt_has() { [[ "$(apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/ {print $2}')" =~ ^[0-9] ]]; }
apt_install() { $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq "$@" >>"$LOG" 2>&1; }

# --- system packages ----------------------------------------------------------
printf '[1/9] system      ... '
if [[ -z "$APT" ]]; then
  echo "checking only (--no-apt)"
elif ! have apt-get; then
  echo "checking only (no apt-get: install what is listed below yourself)"
elif [[ -n "$SUDO" ]] && { ! have sudo || { ! sudo -n true 2>/dev/null && ! [[ -t 0 ]]; }; }; then
  echo "checking only (needs root or sudo)"
elif ! $SUDO apt-get update -qq >>"$LOG" 2>&1; then
  echo "apt-get update failed:"; show_log_tail
else
  GOT=(); FAILED=()
  add() {
    local need=() p
    for p in "$@"; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
    (( ${#need[@]} )) || return 0
    if apt_install "${need[@]}"; then GOT+=("${need[@]}"); else FAILED+=("${need[@]}"); fi
  }
  add curl ca-certificates gnupg
  # Node: the distributions' own is 18 on Debian 12 and Ubuntu 22.04/24.04.
  if (( "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" < 20 )); then
    if curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >>"$LOG" 2>&1; then
      add nodejs
    else
      FAILED+=("nodejs (NodeSource)")
    fi
  fi
  have ffmpeg || add ffmpeg
  # Python with venv, and what a package without a wheel needs to build.
  WANT=(build-essential)
  for v in 3.12 3.11; do
    if apt_has "python$v-venv"; then WANT+=("python$v-venv"); apt_has "python$v-dev" && WANT+=("python$v-dev"); break; fi
  done
  add "${WANT[@]}"
  if [[ "$USE" == "public" ]]; then
    if ! have caddy; then
      if ! apt_has caddy; then
        # Caddy's own repository, where the distribution does not carry it.
        curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg >>"$LOG" 2>&1 \
          && curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null \
          && $SUDO apt-get update -qq >>"$LOG" 2>&1
      fi
      add caddy
    fi
  else
    have podman || have docker || add podman
  fi
  if (( ${#FAILED[@]} )); then
    echo "could not install: ${FAILED[*]}"; show_log_tail
  elif (( ${#GOT[@]} )); then
    echo "installed ${GOT[*]}"
  else
    echo "nothing missing"
  fi
fi
# No Python 3.11/3.12 from apt: uv fetches its own, into .run/.
if [[ -n "$APT" && -z "$(pick_python)" ]] && have curl; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$RUN_DIR/uv" sh >>"$LOG" 2>&1 \
    && "$UV" python install 3.12 >>"$LOG" 2>&1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
(( NODE_MAJOR >= 20 )) || todo "Install Node.js 20 or newer (found: ${NODE_MAJOR/#0/none}). On Debian/Ubuntu: https://github.com/nodesource/distributions"
have ffmpeg || todo "Install ffmpeg -- without it every match fails. Debian/Ubuntu: apt install ffmpeg"
[[ -n "$(pick_python)" ]] || todo "Install Python 3.12 (or 3.11) with venv. Debian/Ubuntu: apt install python3.12-venv"

# How much this machine has. The model alone wants a few GB of memory once
# loaded, and pip plus the model cache want several GB of disk.
# In tenths, so a 1 GB server does not read as 0.
MEM_10="$(awk '/MemTotal/ {printf "%d", $2/104857.6}' /proc/meminfo 2>/dev/null || echo 0)"
DISK_10="$(df -Pk . | awk 'NR==2 {printf "%d", $4/104857.6}')"
gb() { printf '%d.%d' $(( $1 / 10 )) $(( $1 % 10 )); }
(( MEM_10 >= 40 )) || todo "Only $(gb "$MEM_10") GB of RAM. Alignment needs about 4 GB (8 is comfortable); with less the sidecar is killed. Without it, reciter passages with published timings still work; uploads do not."
(( DISK_10 >= 100 )) || todo "Only $(gb "$DISK_10") GB free here. The sidecar needs about 10 GB for its packages and model, so it was not installed; if another disk has room, install there."

# --- web app ------------------------------------------------------------------
printf '[2/9] web app     ... '
if (( NODE_MAJOR < 20 )); then
  echo "skipped (no Node.js 20+)"
elif [[ -d node_modules && ! package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "up to date"
elif npm ci >>"$LOG" 2>&1; then
  echo "installed"
else
  echo "npm ci failed:"; show_log_tail
fi

# --- configuration ------------------------------------------------------------
printf '[3/9] settings    ... '
# The mode goes in a file of its own, which ./start.sh turns into
# STUDIO_MODE for the processes it starts -- see src/lib/studioMode.ts. Kept
# out of .env.local so that neither script has to read a file of secrets.
echo "$USE" >.studio-mode
FRESH_ENV=""
[[ -f .env.local ]] || { cp .env.example .env.local; FRESH_ENV=1; }
# The same settings go at the end of .env.local too, so the app is the mode it
# was installed as however it is started -- a plain `npm run start`, a service
# unit -- and not a personal studio with no token behind a public domain. The
# last line for a name wins, so appending is enough, and nothing is read.
{
  echo ""
  echo "# Written by ./install.sh --$USE."
  echo "STUDIO_MODE=$USE"
  if [[ "$USE" == "public" ]]; then
    # The default every visitor can be served; and the sidecar reaches the
    # audio proxy on this machine rather than out through Caddy and back.
    echo "QURAN_TRANSLATION_ID=20"
    echo "NEXT_PUBLIC_QURAN_TRANSLATION_ID=20"
    echo "ALIGN_AUDIO_PROXY_ORIGIN=http://127.0.0.1:3000"
  fi
} >>.env.local
if [[ "$USE" == "public" ]]; then
  echo "public mode, default translation 20"
  todo "A public studio has no token: if .env.local sets STUDIO_TOKEN, every visitor gets a 401 -- remove that line."
else
  echo "personal mode"
  # Said every time rather than checked: finding out would mean reading the
  # secrets in that file, and the reminder costs nothing when it is already set.
  todo "If anyone else can reach this machine, set STUDIO_TOKEN in .env.local (openssl rand -hex 32). Unset means no authentication at all. For a studio meant for everyone, run: ./install.sh --public"
fi

# --- alignment sidecar --------------------------------------------------------
printf '[4/9] sidecar     ... '
PY="$(pick_python)"
VENV="asr-service/.venv"
# A venv made while python3.X-venv was missing has a python and no pip, and
# would fail every run after; one without pip is made again.
if [[ -x "$VENV/bin/python" ]] && ! "$VENV/bin/python" -m pip --version >/dev/null 2>&1; then
  rm -rf "$VENV"
fi
if (( DISK_10 < 100 )) && [[ ! -x "$VENV/bin/python" ]]; then
  # Filling / on a server breaks more than this app.
  echo "skipped (only $(gb "$DISK_10") GB free, needs about 10)"
elif [[ -z "$PY" && ! -x "$VENV/bin/python" ]]; then
  echo "skipped (no Python 3.11/3.12)"
elif [[ ! -x "$VENV/bin/python" ]] && ! { "$PY" -m venv "$VENV" >>"$LOG" 2>&1 && "$VENV/bin/python" -m pip --version >/dev/null 2>&1; }; then
  rm -rf "$VENV"
  echo "could not make a virtualenv with $PY:"; show_log_tail
  todo "Python's venv module is missing. Debian/Ubuntu: apt install $(basename "$PY")-venv, then run this again."
else
  PIP=("$VENV/bin/python" -m pip --disable-pip-version-check --no-cache-dir)
  # Debian 12's pip 23 cannot install torch from its index (it trips over a
  # dependency's metadata there).
  "${PIP[@]}" install -q --upgrade pip >>"$LOG" 2>&1
  # Without an NVIDIA GPU, torch AND torchaudio come from the CPU index,
  # together. The default wheels bundle 2-3 GB of CUDA; and a torchaudio left
  # for NeMo to pull from PyPI is the CUDA build, whose library will not load
  # beside a CPU torch.
  if ! "$VENV/bin/python" -c 'import torch, torchaudio' >/dev/null 2>&1; then
    if nvidia-smi -L >/dev/null 2>&1; then
      "${PIP[@]}" install torch torchaudio >>"$LOG" 2>&1
    else
      "${PIP[@]}" install torch torchaudio --index-url https://download.pytorch.org/whl/cpu >>"$LOG" 2>&1
    fi
  fi
  STAMP="$VENV/.requirements-installed"
  if [[ -f "$STAMP" && ! asr-service/requirements.txt -nt "$STAMP" ]]; then
    echo "up to date"
  elif "${PIP[@]}" install -r asr-service/requirements.txt >>"$LOG" 2>&1; then
    touch "$STAMP"
    echo "installed"
  else
    echo "pip install failed:"; show_log_tail
  fi
  # The one check that proves the pair works: this loads torchaudio's library.
  "$VENV/bin/python" -c 'import torch, torchaudio.functional as F; F.forced_align(torch.randn(1,8,4).log_softmax(-1), torch.tensor([[1,2]]), blank=0)' >>"$LOG" 2>&1 \
    || todo "torch/torchaudio do not load together (see $LOG). On a machine without a GPU: $VENV/bin/pip install --force-reinstall --no-deps torch torchaudio --index-url https://download.pytorch.org/whl/cpu"
fi

# --- Hugging Face login and the model -------------------------------------------
# The alignment model is gated, and until this machine holds a token that has
# accepted its terms, every alignment fails with a 401. So this does not stop
# at "a token is stored": it downloads the model, which is the one check that
# proves access -- and means the first alignment does not wait on ~0.5 GB.
printf '[5/9] model       ... '
MODEL="Muno459/fastconformer-quran"
fetch_model() {
  # 0 downloaded, 2 no usable token, 3 token without access, 1 anything else.
  "$VENV/bin/python" - "$MODEL" >>"$LOG" 2>&1 <<'PY'
import sys
from huggingface_hub import hf_hub_download
try:
    hf_hub_download(repo_id=sys.argv[1], filename="nemo/fastconformer-quran.nemo")
except Exception as exc:
    print(f"{type(exc).__name__}: {exc}")
    status = getattr(getattr(exc, "response", None), "status_code", None)
    sys.exit(2 if status == 401 else 3 if status == 403 else 1)
PY
}
hf_login() {
  HF_LOGIN_TOKEN="$1" "$VENV/bin/python" -c 'import os; from huggingface_hub import login; login(token=os.environ["HF_LOGIN_TOKEN"])' >>"$LOG" 2>&1
}
MODEL_HOWTO="accept its terms while signed in at https://huggingface.co/$MODEL, and make a read token at https://huggingface.co/settings/tokens"
if [[ ! -x "$VENV/bin/python" ]] || ! "$VENV/bin/python" -c 'import huggingface_hub' >/dev/null 2>&1; then
  echo "skipped (no sidecar)"
  todo "Once the sidecar installs, run this again: it sets up the alignment model, which needs a Hugging Face account."
else
  [[ -n "${HF_TOKEN:-}" ]] && hf_login "$HF_TOKEN"
  fetch_model; RC=$?
  # Asked for here, where it can be fixed on the spot, rather than left for the
  # first alignment to fail over.
  while (( RC == 2 || RC == 3 )) && [[ -t 0 ]]; do
    echo
    if (( RC == 2 )); then
      echo "      The alignment model is gated. To use it, $MODEL_HOWTO."
      read -r -s -p "      Paste the token (blank to skip): " TOKEN; echo
      [[ -n "$TOKEN" ]] || break
      hf_login "$TOKEN" || { echo "      Hugging Face did not accept that token."; continue; }
    else
      echo "      This token's account has not accepted the model's terms: open https://huggingface.co/$MODEL, sign in and accept."
      read -r -p "      Press Enter once accepted (or type skip): " ANSWER
      [[ "$ANSWER" == skip ]] && break
    fi
    printf '[5/9] model       ... '
    fetch_model; RC=$?
  done
  case $RC in
    0) echo "downloaded, access confirmed" ;;
    2) echo "not logged in to Hugging Face"
       todo "Alignment will fail until the gated model is reachable: $MODEL_HOWTO, then run this again (or HF_TOKEN=hf_... ./install.sh)." ;;
    3) echo "this Hugging Face account has not accepted the model's terms"
       todo "Accept the model's terms at https://huggingface.co/$MODEL with the account whose token this machine holds, then run this again." ;;
    *) echo "download failed:"; show_log_tail
       todo "The alignment model did not download (see above). Run this again once it is fixed." ;;
  esac
fi

# --- database -------------------------------------------------------------------
printf '[6/9] database    ... '
if [[ "$USE" == "public" ]]; then
  echo "not used (public: projects are kept in each visitor's browser)"
elif ! have podman && ! have docker; then
  echo "skipped (no podman or docker -- saves stay in memory)"
  todo "For saved projects that survive a restart: apt install podman, then run this again."
elif ! scripts/db.sh start >>"$LOG" 2>&1; then
  echo "did not start:"; show_log_tail
else
  # Written only into a .env.local this run created, whose contents are
  # known; an existing one is yours, and may already name a database.
  if [[ -n "$FRESH_ENV" ]]; then
    echo 'DATABASE_URL=postgres://quranclipper:quranclipper@127.0.0.1:5432/quranclipper' >>.env.local
  else
    todo "For saves in this database, .env.local needs: DATABASE_URL=postgres://quranclipper:quranclipper@127.0.0.1:5432/quranclipper (skip if it has it)"
  fi
  if (( NODE_MAJOR >= 20 )) && npm run db:push >>"$LOG" 2>&1; then
    echo "up, tables in place"
  else
    echo "up, but creating the tables failed -- see $LOG"
  fi
fi

# --- HTTPS ------------------------------------------------------------------------
# Public only. Caddy fetches and renews the certificate itself. Nothing else
# on this server is touched: an existing Caddyfile is added to, never
# replaced unless it is Caddy's untouched default page, and the firewall gets
# 80 and 443 opened only if it is already on -- every other port stays as it
# was.
printf '[7/9] https       ... '
CADDYFILE="/etc/caddy/Caddyfile"
if [[ "$USE" != "public" ]]; then
  echo "not needed (personal)"
elif [[ -z "$DOMAIN" ]]; then
  echo "skipped (no --domain)"
  todo "For HTTPS, point a domain's DNS at this server and run: ./install.sh --public --domain <your.domain>"
elif ! have caddy; then
  echo "skipped (no caddy)"
  todo "Install Caddy (apt install caddy, or https://caddyserver.com/docs/install), then run this again for HTTPS on $DOMAIN."
elif grep -qF "$DOMAIN" "$CADDYFILE" 2>/dev/null; then
  echo "$DOMAIN already in $CADDYFILE"
else
  BUSY="$(ss -Hltnp 'sport = :80 or sport = :443' 2>/dev/null | grep -v caddy || true)"
  if [[ -n "$BUSY" ]]; then
    echo "skipped (something other than Caddy holds port 80 or 443)"
    todo "Ports 80/443 are in use by another program (ss -ltnp 'sport = :80 or sport = :443'). Caddy needs them for HTTPS on $DOMAIN."
  else
    SITE="$(printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN")"
    if grep -q '/usr/share/caddy' "$CADDYFILE" 2>/dev/null; then
      $SUDO cp "$CADDYFILE" "$CADDYFILE.bak" && printf '%s' "$SITE" | $SUDO tee "$CADDYFILE" >/dev/null
    else
      printf '\n%s' "$SITE" | $SUDO tee -a "$CADDYFILE" >/dev/null
    fi
    if $SUDO systemctl reload caddy >>"$LOG" 2>&1 || $SUDO systemctl restart caddy >>"$LOG" 2>&1; then
      echo "https://$DOMAIN -> the studio"
    else
      echo "Caddy did not reload -- see: journalctl -u caddy"
    fi
    if have ufw && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then
      $SUDO ufw allow 80/tcp >>"$LOG" 2>&1; $SUDO ufw allow 443/tcp >>"$LOG" 2>&1
    fi
  fi
fi

# --- local-only data --------------------------------------------------------------
printf '[8/9] local data  ... '
MISSING=()
[[ -n "$(ls -A public/fonts 2>/dev/null)" ]] || MISSING+=("mushaf fonts (public/fonts/)")
[[ -d data/qul ]] || MISSING+=("QUL data (data/qul/)")
if (( ${#MISSING[@]} )); then
  echo "missing: ${MISSING[*]}"
  todo "Optional: the mushaf fonts and QUL data (the studio uses Amiri without them). Download them from a free account at https://qul.tarteel.ai into data/qul/ and run: node scripts/qul-import.mjs -- see \"Mushaf fonts and QUL data\" in README.md. Or copy data/qul/ and public/fonts/ from a machine that has them."
else
  echo "present"
fi
if [[ "$USE" == "public" && -d data/local-translations ]]; then
  todo "data/local-translations/ is on this server but is never served in public mode. Delete it if it should not be here at all."
fi

# --- recordings ---------------------------------------------------------------------
# Every built-in reciter's recordings, kept on this disk so a load never waits
# on -- or fails on -- a CDN. The studio decides which file each surah plays,
# so the download asks it (scripts/prefetch-audio.mjs): the one on :3000 if it
# is running, otherwise one started here for the purpose and stopped after.
printf '[9/9] recordings  ... '
KEPT_BEFORE="$(find data/audio-cache -name '*.audio' 2>/dev/null | wc -l)"
DISK_NOW_10="$(df -Pk . | awk 'NR==2 {printf "%d", $4/104857.6}')"
if [[ -z "$RECORDINGS" ]]; then
  echo "skipped (--no-recordings): $KEPT_BEFORE kept"
elif (( NODE_MAJOR < 20 )); then
  echo "skipped (no Node.js 20+)"
elif (( KEPT_BEFORE < 1140 && DISK_NOW_10 < 200 )); then
  echo "skipped (only $(gb "$DISK_NOW_10") GB free, needs about 20)"
  todo "The reciters' recordings need about 14 GB. Free some space and run: ./install.sh again (or ./install.sh --no-recordings to leave them to the CDNs)."
else
  if (( KEPT_BEFORE >= 1140 )); then echo "checking the $KEPT_BEFORE kept"
  else echo "downloading -- about 14 GB, half an hour or so the first time (progress: $RUN_DIR/prefetch.log)"; fi
  STUDIO_TOKEN="$(sed -n 's/^STUDIO_TOKEN=//p' .env.local 2>/dev/null | tail -n 1 | tr -d "\"'")"
  AUTH=(); [[ -n "$STUDIO_TOKEN" ]] && AUTH=(-H "Authorization: Bearer $STUDIO_TOKEN")
  # Whether a studio on :3000 says when it answers from its kept recordings,
  # which the download waits for -- one built before that never does.
  # Al-Fatihah is under 1 MB, so a studio that keeps it says so at once.
  reports_kept() {
    curl -sf --max-time 2 http://127.0.0.1:3000/api/health >/dev/null 2>&1 || return 1
    for _ in $(seq 1 15); do
      curl -s --max-time 30 -r 0-0 "${AUTH[@]}" -D - -o /dev/null \
        'http://127.0.0.1:3000/api/audio/proxy?url=https%3A%2F%2Fdownload.quranicaudio.com%2Fqdc%2Fabdurrahmaan_as_sudais%2Fmurattal%2F1.mp3' \
        2>/dev/null | grep -qi '^x-audio-cache: hit' && return 0
      sleep 2
    done
    return 1
  }
  PORT=3000; TEMP_PID=""
  if ! reports_kept; then
    PORT=3999
    setsid npx next dev -p "$PORT" >"$RUN_DIR/prefetch-studio.log" 2>&1 &
    TEMP_PID=$!
    for _ in $(seq 1 120); do
      curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  STUDIO_TOKEN="$STUDIO_TOKEN" node scripts/prefetch-audio.mjs --port "$PORT" >"$RUN_DIR/prefetch.log" 2>&1
  PREFETCH_OK=$?
  [[ -n "$TEMP_PID" ]] && kill -- "-$TEMP_PID" 2>/dev/null
  KEPT="$(find data/audio-cache -name '*.audio' 2>/dev/null | wc -l)"
  SIZE="$(du -sh data/audio-cache 2>/dev/null | cut -f1)"
  printf '[9/9] recordings  ... '
  if (( PREFETCH_OK == 0 )); then
    echo "all kept: $KEPT recordings, $SIZE"
  else
    echo "$KEPT kept ($SIZE); some failed -- see $RUN_DIR/prefetch.log"
    todo "Some recordings did not download (a CDN refused, or the studio did not start). Run ./install.sh again to fetch just those; the studio plays the rest from the CDN meanwhile."
  fi
fi

# --- summary ----------------------------------------------------------------------
# Back to the terminal, and the copy finished, before reading it back.
exec >&3 3>&-
wait "$TEE_PID" 2>/dev/null
echo
echo "  Status:"
grep -a '^\[[0-9]/9\]' "$SHOWN" | awk '{ last[$1] = $0; if (!($1 in seen)) { seen[$1] = 1; order[++n] = $1 } } END { for (i = 1; i <= n; i++) print "  " last[order[i]] }'
echo
if (( ${#TODO[@]} )); then
  echo "  Still to do:"
  for item in "${TODO[@]}"; do echo "  - $item"; done
  echo
fi
echo "  Then start everything with:  ./start.sh --prod"
echo "  full install log in $LOG"
