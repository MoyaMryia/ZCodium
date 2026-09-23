#!/usr/bin/env bash
# Environment preparation for the docx skill (macOS / Linux).
#
# Checks what the skill needs and installs what is missing. Idempotent: on a
# working environment it changes nothing. See env_check.sh for the check-only
# path, and env_setup/setup.md for the narrative version of this file.
#
#   setup.sh                 check, then install if needed (prompts first)
#   setup.sh --check-only    check only, never install
#   setup.sh --yes           install without prompting
#   setup.sh --help          this text
#
# The whole dependency list is Python + defusedxml. LibreOffice is
# install-on-demand for the conversion and visual-verification steps: it is
# large, and when a task needs it and it is absent, the task reports that —
# it is never silently switched to another program (Word/WPS/Pages) and the
# PDF/visual check is never skipped because the download is big.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Keep the plugin tree free of __pycache__.
export PYTHONDONTWRITEBYTECODE=1

CHECK_ONLY=0
ASSUME_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h)
      sed -n '2,22p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'
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

have() { command -v "$1" >/dev/null 2>&1; }

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if have python3; then PYTHON=python3
  elif have python;  then PYTHON=python
  fi
fi

say "== docx skill environment =="

need_install=0

if [ -z "$PYTHON" ]; then
  say "MISSING  python3"
  need_install=1
else
  say "ok       python ($("$PYTHON" --version 2>&1))"
fi

if [ -n "$PYTHON" ]; then
  if "$PYTHON" -c 'import defusedxml' >/dev/null 2>&1; then
    say "ok       defusedxml"
  else
    say "MISSING  defusedxml"
    need_install=1
  fi
fi

if have soffice; then
  say "ok       soffice (on-demand: .doc->.docx, DOCX->PDF, visual verification)"
else
  say "MISSING  soffice (on-demand — install only when a task needs conversion)"
  need_install=1
fi

if [ "$need_install" -eq 0 ]; then
  say ""
  say "environment ready"
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  say ""
  say "--check-only: nothing installed"
  exit 1
fi

# ------------------------------------------------------------------ install

say ""
say "== installing =="

if have apt-get;        then install_pkgs() { sudo apt-get install -y "$@"; }
elif have dnf;          then install_pkgs() { sudo dnf install -y "$@"; }
elif have pacman;       then install_pkgs() { sudo pacman -S --noconfirm "$@"; }
elif have brew;         then install_pkgs() { brew install "$@"; }
else install_pkgs() { warn "no supported package manager (apt/dnf/pacman/brew)"; return 1; }; fi

install_with() {
  local desc="$1"; shift
  if [ "$ASSUME_YES" -eq 0 ]; then
    printf 'install %s? [y/N] ' "$desc" >&2
    read -r reply || reply=""
    case "$reply" in y|Y|yes|YES) ;; *) say "skipped: $desc"; return 0 ;; esac
  fi
  if "$@"; then say "installed: $desc"; else warn "install failed: $desc"; fi
}

if [ -z "$PYTHON" ]; then
  install_with "python3" install_pkgs python3
  PYTHON=python3
fi

if [ -n "$PYTHON" ] && ! "$PYTHON" -c 'import defusedxml' >/dev/null 2>&1; then
  install_with "defusedxml" "$PYTHON" -m pip install defusedxml
fi

if ! have soffice; then
  printf 'install LibreOffice (soffice)? needed only for .doc->.docx, DOCX->PDF and visual checks. [y/N] ' >&2
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) install_with "libreoffice" install_pkgs libreoffice ;;
    *) say "skipped: libreoffice — conversion and visual-verification steps will report it as unavailable" ;;
  esac
fi

# ------------------------------------------------------------------ re-check

say ""
bash "$SCRIPT_DIR/env_check.sh"
exit $?
