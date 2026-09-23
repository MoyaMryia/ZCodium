#!/usr/bin/env bash
# Environment preparation for the xlsx skill.
#
# Thin entry point: the real logic lives in env_setup/setup_mac_linux.sh (and
# env_setup/setup_windows.ps1 on Windows). This file exists so the familiar
# `bash setup.sh` from the skill root works, and so the check-only path is one
# command away.
#
#   setup.sh                 check, then install if needed (prompts first)
#   setup.sh --check-only    check only, never install
#   setup.sh --yes           install without prompting
#   setup.sh --help          this text

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "on Windows, run: powershell -ExecutionPolicy Bypass -File env_setup\\setup_windows.ps1"
    exit 2
    ;;
esac

if [ ! -f "$SCRIPT_DIR/env_setup/setup_mac_linux.sh" ]; then
  printf 'error: env_setup/setup_mac_linux.sh not found next to this script\n' >&2
  exit 2
fi

exec bash "$SCRIPT_DIR/env_setup/setup_mac_linux.sh" "$@"
