# Third-party notices

## scripts/mcp/server.mjs — original work, written against public CLIs

This MCP server is original code written for this repository. It drives the
Android Debug Bridge and the emulator through their public command-line
interfaces (`adb devices`, `adb install`, `adb shell input`, `adb exec-out
screencap -p`, `adb shell uiautomator dump`, `emulator -list-avds`,
`adb wait-for-device`). Those command lines and their flags are documented,
factual interfaces; no upstream source code was read, vendored or derived.

The survey that considered upstream MCP servers and rejected them as bases is
recorded in `.agents/specs/plugin-backfill-openbase-survey.md`. In short: the
candidates either had no license, or were derivation bases weaker than writing
against the public CLI directly.

## skills/, commands/, templates/ — original work

`skills/android-dev/SKILL.md`, `skills/android-dev/INSTALL_ENVIRONMENT.md`,
`commands/android-dev.md` and `templates/compose-app/README.md` are original
work written from public documentation (the Android developer documentation,
the Gradle and SDK manager command lines) and from the tool surface this
plugin's MCP server actually exposes. They are covered by the repository's
root Apache-2.0 license, with the manifests reading `MIT` to match the
plugin family.

## hooks/hooks.json

An empty hook registration, matching the plugin contract. No third-party
content.
