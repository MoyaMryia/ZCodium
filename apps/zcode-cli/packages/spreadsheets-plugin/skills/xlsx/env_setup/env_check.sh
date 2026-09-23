#!/usr/bin/env bash
# Dependency self-check for the xlsx skill: interpreter version, openpyxl, the
# script files the skill depends on, and LibreOffice for recalculation.
# Exit 0 when everything required passes, 1 otherwise.
#
# No network access, no installation, no writes to the plugin tree.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Importing the package must not litter the tree with __pycache__.
export PYTHONDONTWRITEBYTECODE=1

failures=0

pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf '[WARN] %s\n' "$*"; }

# ---------------------------------------------------------------- interpreter

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if command -v python3 >/dev/null 2>&1; then PYTHON=python3
  elif command -v python >/dev/null 2>&1; then PYTHON=python
  fi
fi

if [ -z "$PYTHON" ]; then
  fail "python interpreter (python3 or python) not on PATH"
else
  version="$("$PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "0.0")"
  major="${version%%.*}"; minor="${version##*.}"
  if [ "$major" -gt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -ge 10 ]; }; then
    pass "python $version"
  else
    fail "python $version — the scripts need 3.10 or newer"
  fi
fi

# ------------------------------------------------------------------- openpyxl

if [ -n "$PYTHON" ]; then
  if "$PYTHON" -c 'import openpyxl' >/dev/null 2>&1; then
    pass "openpyxl"
  else
    fail "openpyxl — python3 -m pip install openpyxl (every path in SKILL.md needs it)"
  fi
fi

# ------------------------------------------------------------------ LibreOffice

# Not substitutable: when recalculation is needed and soffice is absent, the
# recalculation step reports it (recalc.py returns {"error": ...}) — it never
# fails silently and never substitutes another program.
if command -v soffice >/dev/null 2>&1; then
  pass "soffice ($(soffice --version 2>/dev/null | head -1))"
else
  warn "soffice not found — scripts/recalc.py will report an error instead of recalculating"
fi

# --------------------------------------------------------------- script files

for script in scripts/recalc.py xlsx.py templates/base.py templates/palettes.py; do
  if [ -f "$SKILL_DIR/$script" ]; then
    pass "$script present"
  else
    fail "$script missing"
  fi
done

if [ "$failures" -eq 0 ]; then
  printf '\nenvironment ready\n'
  exit 0
fi
printf '\n%d check(s) failed\n' "$failures"
exit 1
