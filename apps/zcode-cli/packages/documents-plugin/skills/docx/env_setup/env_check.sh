#!/usr/bin/env bash
# Dependency self-check for the docx skill: interpreter version, defusedxml, and
# the script files the skill depends on. Exit 0 when everything passes, 1 otherwise.
#
# No network access, no installation, no writes to the plugin tree.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPTS_DIR="$SKILL_DIR/scripts"

# Importing the package must not litter the tree with __pycache__.
export PYTHONDONTWRITEBYTECODE=1

MIN_MAJOR=3
MIN_MINOR=10

failures=0

pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; failures=$((failures + 1)); }

# ---------------------------------------------------------------- interpreter

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
  elif command -v python >/dev/null 2>&1; then
    PYTHON=python
  else
    fail "no python3 interpreter on PATH"
    printf '\n%d check(s) failed\n' "$failures"
    exit 1
  fi
fi

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  fail "PYTHON=$PYTHON is not executable"
  printf '\n%d check(s) failed\n' "$failures"
  exit 1
fi

version="$("$PYTHON" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)"
if [ -z "$version" ]; then
  fail "$PYTHON did not report a version"
else
  if awk -v v="$version" -v maj="$MIN_MAJOR" -v min="$MIN_MINOR" 'BEGIN {
        split(v, got, ".")
        if (got[1] > maj) exit 0
        if (got[1] == maj && got[2] >= min) exit 0
        exit 1
      }'; then
    pass "python $version ($PYTHON) meets ${MIN_MAJOR}.${MIN_MINOR}+"
  else
    fail "python $version is older than the required ${MIN_MAJOR}.${MIN_MINOR} ($PYTHON)"
  fi
fi

# ------------------------------------------------------------------ defusedxml

if "$PYTHON" -c 'import defusedxml.minidom, defusedxml.sax' 2>/dev/null; then
  defusedxml_version="$("$PYTHON" -c 'import defusedxml; print(getattr(defusedxml, "__version__", "unknown"))' 2>/dev/null)"
  pass "defusedxml importable (${defusedxml_version:-unknown})"
else
  fail "defusedxml is not importable by $PYTHON — install with: $PYTHON -m pip install defusedxml"
fi

# -------------------------------------------------------------- plugin scripts

required=(
  "__init__.py"
  "document.py"
  "utilities.py"
  "packing.py"
  "identifiers.py"
  "docx_editor.py"
  "tracked_changes.py"
  "comments.py"
  "postcheck.py"
  "postcheck_document.py"
  "postcheck_rules.py"
  "fix_footer_fields.py"
  "add_toc_placeholders.py"
)

for name in "${required[@]}"; do
  if [ -f "$SCRIPTS_DIR/$name" ]; then
    pass "scripts/$name present"
  else
    fail "scripts/$name missing — the skill cannot run without it"
  fi
done

for name in comments.xml commentsExtended.xml commentsIds.xml commentsExtensible.xml people.xml; do
  if [ -f "$SCRIPTS_DIR/templates/$name" ]; then
    pass "scripts/templates/$name present"
  else
    fail "scripts/templates/$name missing"
  fi
done

# --------------------------------------------------------- import smoke check

# scripts.document uses a relative import, so skills/docx must be on sys.path.
if "$PYTHON" -c 'import sys; sys.path.insert(0, sys.argv[1]); import scripts.document' "$SKILL_DIR" 2>/dev/null; then
  pass "scripts.document imports"
else
  fail "scripts.document failed to import — check the Python version and defusedxml"
fi

# The three CLI scripts import each other by flat module name.
if "$PYTHON" -c 'import sys; sys.path.insert(0, sys.argv[1]); import postcheck, postcheck_document, postcheck_rules, fix_footer_fields, add_toc_placeholders' "$SCRIPTS_DIR" 2>/dev/null; then
  pass "the three CLI scripts import"
else
  fail "a CLI script failed to import — check the Python version and defusedxml"
fi

if [ "$failures" -eq 0 ]; then
  printf '\nall checks passed\n'
  exit 0
fi
printf '\n%d check(s) failed\n' "$failures"
exit 1
