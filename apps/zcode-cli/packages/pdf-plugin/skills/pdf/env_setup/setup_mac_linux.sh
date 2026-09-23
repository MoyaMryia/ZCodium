#!/usr/bin/env bash
# Environment preparation for the pdf skill (macOS / Linux).
#
# Checks what the build needs and installs what is missing. Idempotent: on a
# working environment it changes nothing. See env_check.sh for the check-only
# path, and env_setup/setup.md for the narrative version of this file.
#
#   setup.sh                 check, then install what is missing
#   setup.sh --check-only    check only, never install
#   setup.sh --yes           install without prompting
#   setup.sh --help          this text
#
# TeX Live / MiKTeX / MacTeX are NOT installed by this script: they are large,
# platform-specific installations the user should choose deliberately. This
# script installs the small pieces — poppler tools, Python, the Python
# dependencies the scripts/ need — and reports the TeX distribution as a
# prerequisite when it is absent.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CHECK_ONLY=0
ASSUME_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h)
      sed -n '2,20p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      printf "run '%s --help'\n" "$0" >&2
      exit 2
      ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*" >&2; }

# ---------------------------------------------------------------- detection

have() { command -v "$1" >/dev/null 2>&1; }

missing=()

check_group() {
  local label="$1"; shift
  local absent=()
  for tool in "$@"; do
    have "$tool" || absent+=("$tool")
  done
  if [ "${#absent[@]}" -eq 0 ]; then
    say "ok       $label"
  else
    say "MISSING  $label: ${absent[*]}"
    missing+=("${absent[@]}")
  fi
}

say "== pdf skill environment =="

# A TeX distribution is a deliberate, large install — detect and report only.
if have latexmk || have xelatex || have pdflatex; then
  say "ok       TeX distribution"
else
  warn "no TeX distribution found (TeX Live / MiKTeX / MacTeX) — install one before building"
fi

check_group "rasterize"  pdftoppm mutool magick gs
check_group "inspect"    pdfinfo pdffonts
check_group "html path"  soffice

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if have python3; then PYTHON=python3
  elif have python;  then PYTHON=python
  else PYTHON=""
  fi
fi
if [ -n "$PYTHON" ]; then
  say "ok       python ($("$PYTHON" --version 2>&1))"
else
  say "MISSING  python3"
  missing+=(python3)
fi

if [ "${#missing[@]}" -eq 0 ]; then
  say ""
  say "environment ready"
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  say ""
  say "--check-only: nothing installed"
  exit 1
fi

# ---------------------------------------------------------------- install

say ""
say "== installing missing pieces =="

install_with() {
  # install_with <description> <command...>
  local desc="$1"; shift
  if [ "$ASSUME_YES" -eq 0 ]; then
    printf 'install %s with "%s"? [y/N] ' "$desc" "$*" >&2
    read -r reply || reply=""
    case "$reply" in
      y|Y|yes|YES) ;;
      *) say "skipped: $desc"; return 0 ;;
    esac
  fi
  if "$@"; then
    say "installed: $desc"
  else
    warn "install failed: $desc"
  fi
}

if have apt-get; then
  PM="apt-get"
  install_pkgs() { sudo apt-get install -y "$@"; }
elif have dnf; then
  PM="dnf"
  install_pkgs() { sudo dnf install -y "$@"; }
elif have pacman; then
  PM="pacman"
  install_pkgs() { sudo pacman -S --noconfirm "$@"; }
elif have brew; then
  PM="brew"
  install_pkgs() { brew install "$@"; }
else
  PM=""
  warn "no supported package manager found (apt/dnf/pacman/brew)"
fi

# poppler provides pdftoppm/pdfinfo/pdffonts on every platform above.
if [ -n "$PM" ] && ! have pdftoppm; then
  install_with "poppler tools" install_pkgs poppler
fi

if [ -n "$PYTHON" ] && [ "$PYTHON" != "python3-missing" ]; then
  # The Python dependencies the scripts/ declare in their PEP 723 headers.
  if ! "$PYTHON" -c 'import pypdf, pdf2image, PIL' >/dev/null 2>&1; then
    install_with "python deps (pypdf, pdf2image, Pillow)" \
      "$PYTHON" -m pip install pypdf pdf2image Pillow
  fi
fi

# ---------------------------------------------------------------- re-check

say ""
bash "$SCRIPT_DIR/env_check.sh"
exit $?
