#!/usr/bin/env bash
# Environment preparation for the docx skill.
#
# Verifies the interpreter and defusedxml, and installs defusedxml when it is
# missing. Idempotent: running it on a working environment changes nothing.
#
#   setup.sh                 check, then install if needed (prompts first)
#   setup.sh --check-only    check only, never install
#   setup.sh --yes           install without prompting
#   setup.sh --help          this text
#
# A virtual environment is recommended when several projects share the machine;
# set PYTHON to the interpreter that should be used, e.g.
#   PYTHON=.venv/bin/python bash setup.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# setup.sh sits at skills/docx/setup.sh, so the script dir *is* the skill dir.
SKILL_DIR="$SCRIPT_DIR"
ENV_CHECK="$SKILL_DIR/env_setup/env_check.sh"

# Keep the plugin tree free of __pycache__.
export PYTHONDONTWRITEBYTECODE=1

CHECK_ONLY=0
ASSUME_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h)
      sed -n '2,15p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'
      exit 0
    ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      printf "run '%s --help' for usage\n" "$0" >&2
      exit 2
    ;;
  esac
  shift
done

if [ ! -f "$ENV_CHECK" ]; then
  printf 'error: env_check.sh not found at %s\n' "$ENV_CHECK" >&2
  exit 2
fi

printf '== checking the docx skill environment ==\n'
bash "$ENV_CHECK"
status=$?
if [ "$status" -eq 0 ]; then
  printf '\nenvironment ready\n'
  exit 0
fi
if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '\n--check-only: nothing installed\n'
  exit "$status"
fi

# ------------------------------------------------------------------ install

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
  elif command -v python >/dev/null 2>&1; then
    PYTHON=python
  else
    printf 'error: no python interpreter on PATH\n' >&2
    exit 1
  fi
fi

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  printf 'error: PYTHON=%s is not executable\n' "$PYTHON" >&2
  exit 1
fi

printf '\ndefusedxml is missing for %s.\n' "$PYTHON"
if [ "$ASSUME_YES" -eq 0 ]; then
  printf 'install it with "%s -m pip install defusedxml"? [y/N] ' "$PYTHON"
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) ;;
    *)
      printf 'aborted; install it yourself with: %s -m pip install defusedxml\n' "$PYTHON"
      exit 1
    ;;
  esac
fi

if "$PYTHON" -m pip install defusedxml; then
  printf '\n== re-checking ==\n'
  bash "$ENV_CHECK"
  exit $?
fi

# PEP 668: the interpreter refuses to touch an externally managed environment.
printf '\nplain install was refused. Retry with one of:\n' >&2
printf '  %s -m pip install --user defusedxml\n' "$PYTHON" >&2
printf '  %s -m venv .venv && .venv/bin/pip install defusedxml\n' "$PYTHON" >&2
printf '  PYTHON=.venv/bin/python bash %s\n' "$0" >&2
exit 1
