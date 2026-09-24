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
#   ./install.sh ... --apt           also apt-get ffmpeg, Python, podman / Caddy
#                                    (Debian/Ubuntu; as root or with sudo)
#   HF_TOKEN=hf_... ./install.sh     log in to Hugging Face without a prompt
#
# Not installed here, because they cannot be fetched: the mushaf fonts and the
# QUL data (downloaded from a signed-in qul.tarteel.ai account). The studio
# works without them -- the Arabic is drawn in Amiri -- and the end of the run
# says how to add them. See "Mushaf fonts and QUL data" in README.md.
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")" || exit 1

APT=""; USE=""; DOMAIN=""
while (( $# )); do
  case "$1" in
    --apt) APT=1 ;;
    --personal) USE="personal" ;;
    --public) USE="public" ;;
    --domain) DOMAIN="${2:-}"; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
TODO=()
todo() { TODO+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
echo "Installing a $USE studio."

# Python 3.11 or 3.12: NeMo has no wheels for 3.13+.
pick_python() {
  for py in python3.12 python3.11; do have "$py" && { echo "$py"; return; }; done
}

# --- system packages ----------------------------------------------------------
printf '[1/8] system      ... '
if [[ -n "$APT" ]]; then
  if ! have apt-get; then
    echo "skipped (--apt needs apt-get)"
  else
    VENV_PKG="python3.12-venv"
    apt-cache show python3.12-venv >/dev/null 2>&1 || VENV_PKG="python3.11-venv"
    EXTRA="podman"; [[ "$USE" == "public" ]] && EXTRA="caddy"
    if $SUDO apt-get update -qq >>"$LOG" 2>&1 \
       && $SUDO apt-get install -y -qq ffmpeg curl "$VENV_PKG" "$EXTRA" >>"$LOG" 2>&1; then
      echo "installed ffmpeg, $VENV_PKG, $EXTRA"
    else
      echo "apt-get failed -- see $LOG"
    fi
  fi
else
  echo "checking (pass --apt to install what is missing)"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
(( NODE_MAJOR >= 20 )) || todo "Install Node.js 20 or newer (found: ${NODE_MAJOR/#0/none}). On Debian/Ubuntu: https://github.com/nodesource/distributions"
have ffmpeg || todo "Install ffmpeg -- without it every match fails. Debian/Ubuntu: apt install ffmpeg (or ./install.sh --apt)"
[[ -n "$(pick_python)" ]] || todo "Install Python 3.12 (or 3.11) with venv. Debian/Ubuntu: apt install python3.12-venv (or ./install.sh --apt)"

# How much this machine has. The model alone wants a few GB of memory once
# loaded, and pip plus the model cache want several GB of disk.
MEM_GB="$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0)"
DISK_GB="$(df -Pk . | awk 'NR==2 {printf "%d", $4/1048576}')"
(( MEM_GB >= 4 )) || todo "Only ${MEM_GB} GB of RAM. Alignment needs about 4 GB (8 is comfortable); with less it swaps heavily or is killed."
(( DISK_GB >= 10 )) || todo "Only ${DISK_GB} GB free here. The sidecar needs about 10 GB for its packages and model; if another disk has room, install there."

# --- web app ------------------------------------------------------------------
printf '[2/8] web app     ... '
if (( NODE_MAJOR < 20 )); then
  echo "skipped (no Node.js 20+)"
elif [[ -d node_modules && ! package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "up to date"
elif npm ci >>"$LOG" 2>&1; then
  echo "installed"
else
  echo "npm ci failed -- see $LOG"
fi

# --- configuration ------------------------------------------------------------
printf '[3/8] settings    ... '
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
printf '[4/8] sidecar     ... '
PY="$(pick_python)"
VENV="asr-service/.venv"
if [[ -z "$PY" && ! -x "$VENV/bin/python" ]]; then
  echo "skipped (no Python 3.11/3.12)"
else
  [[ -x "$VENV/bin/python" ]] || "$PY" -m venv "$VENV" >>"$LOG" 2>&1
  PIP=("$VENV/bin/python" -m pip --disable-pip-version-check)
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
    echo "pip install failed -- see $LOG"
  fi
  # The one check that proves the pair works: this loads torchaudio's library.
  "$VENV/bin/python" -c 'import torch, torchaudio.functional as F; F.forced_align(torch.randn(1,8,4).log_softmax(-1), torch.tensor([[1,2]]), blank=0)' >>"$LOG" 2>&1 \
    || todo "torch/torchaudio do not load together (see $LOG). On a machine without a GPU: $VENV/bin/pip install --force-reinstall --no-deps torch torchaudio --index-url https://download.pytorch.org/whl/cpu"
fi

# --- Hugging Face login ---------------------------------------------------------
printf '[5/8] model login ... '
HF="$VENV/bin/hf"
if [[ ! -x "$HF" ]]; then
  echo "skipped (no sidecar)"
elif "$HF" auth whoami >/dev/null 2>&1; then
  echo "logged in"
elif [[ -n "${HF_TOKEN:-}" ]] && "$HF" auth login --token "$HF_TOKEN" >>"$LOG" 2>&1; then
  echo "logged in with HF_TOKEN"
else
  echo "not logged in"
  todo "The alignment model is gated: accept its terms at https://huggingface.co/Muno459/fastconformer-quran, make a read token at https://huggingface.co/settings/tokens, then run: $HF auth login"
fi

# --- database -------------------------------------------------------------------
printf '[6/8] database    ... '
if [[ "$USE" == "public" ]]; then
  echo "not used (public: projects are kept in each visitor's browser)"
elif ! have podman && ! have docker; then
  echo "skipped (no podman or docker -- saves stay in memory)"
  todo "For saved projects that survive a restart: apt install podman (or ./install.sh --apt), then run this again."
elif ! scripts/db.sh start >>"$LOG" 2>&1; then
  echo "did not start -- see $LOG"
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
printf '[7/8] https       ... '
CADDYFILE="/etc/caddy/Caddyfile"
if [[ "$USE" != "public" ]]; then
  echo "not needed (personal)"
elif [[ -z "$DOMAIN" ]]; then
  echo "skipped (no --domain)"
  todo "For HTTPS, point a domain's DNS at this server and run: ./install.sh --public --domain <your.domain> --apt"
elif ! have caddy; then
  echo "skipped (no caddy -- add --apt, or apt install caddy)"
  todo "Install Caddy (./install.sh --public --domain $DOMAIN --apt) for HTTPS on $DOMAIN."
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
printf '[8/8] local data  ... '
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

# --- summary ----------------------------------------------------------------------
echo
if (( ${#TODO[@]} )); then
  echo "  Still to do:"
  for item in "${TODO[@]}"; do echo "  - $item"; done
  echo
fi
echo "  Then start everything with:  ./start.sh --prod"
echo "  full install log in $LOG"
