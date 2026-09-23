#!/usr/bin/env bash
# Dependency self-check for the pdf skill: TeX toolchain, rasterizers, the HTML
# path's renderer, and the Python interpreter the `scripts/` need.
# Exit 0 when everything required is present, 1 otherwise.
#
# No network access, no installation, no writes to the plugin tree.
# `setup.sh` (and env_setup/setup_mac_linux.sh / setup_windows.ps1) installs.
#
# Usage:
#   bash env_check.sh            human-readable
#   bash env_check.sh --quiet    only failures
#
# Required (a [FAIL] blocks): latexmk or an engine, at least one rasterizer,
# python3 >= 3.10.
# Conditional (a [WARN] notes a gap a particular document path needs):
# biber/bibtex (bibliography documents), soffice (HTML/cover path),
# xelatex/lualatex (fontspec documents).

set -u

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

failures=0

pass() { [ "$QUIET" -eq 1 ] || printf '[PASS] %s\n' "$*"; }
warn() { [ "$QUIET" -eq 1 ] || printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; failures=$((failures + 1)); }

have() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------- TeX stack

if have latexmk; then
  pass "latexmk"
else
  if have xelatex || have pdflatex || have lualatex; then
    warn "latexmk missing — an engine exists, but the skill's build driver is latexmk"
  else
    fail "no TeX toolchain (latexmk / xelatex / pdflatex / lualatex)"
  fi
fi

for engine in xelatex lualatex pdflatex; do
  if have "$engine"; then pass "$engine"; else warn "$engine missing (needed by some documents)"; fi
done

for tool in biber bibtex; do
  if have "$tool"; then pass "$tool"; else warn "$tool missing (needed for bibliography documents)"; fi
done

# ----------------------------------------------------------------- rasterizer

raster_found=0
for tool in pdftoppm pdftocairo mutool magick gs; do
  if have "$tool"; then pass "rasterize: $tool"; raster_found=1; break; fi
done
[ "$raster_found" -eq 1 ] || fail "no rasterizer (pdftoppm / pdftocairo / mutool / magick / gs)"

for tool in pdfinfo pdffonts; do
  if have "$tool"; then pass "$tool"; else warn "$tool missing (page count / font embedding checks)"; fi
done

# ------------------------------------------------------------------ HTML path

if have soffice; then
  pass "soffice (LibreOffice)"
else
  warn "soffice missing (required by html2pdf.py and cover_render.py)"
fi

# -------------------------------------------------------------------- python

PYTHON=""
if have python3; then PYTHON=python3
elif have python; then PYTHON=python
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
  # The scripts' declared dependencies (see each PEP 723 header).
  if "$PYTHON" -c 'import pypdf, pdf2image, PIL' >/dev/null 2>&1; then
    pass "python deps (pypdf, pdf2image, Pillow)"
  else
    warn "python deps incomplete (pypdf / pdf2image / Pillow) — form-filling and QA scripts need them"
  fi
fi

# --------------------------------------------------------------------- verdict

if [ "$failures" -eq 0 ]; then
  [ "$QUIET" -eq 1 ] || printf '\nenvironment ready\n'
  exit 0
fi
printf '\n%d required check(s) failed\n' "$failures"
exit 1
