# Third-party notices

## scripts/mcp/server.mjs — original work, written against a public CLI

This MCP server is original code written for this repository. It drives the
iOS Simulator through the public `xcrun simctl` command line that ships with
Xcode (`simctl list devices -j`, `simctl boot`, `simctl install`,
`simctl launch`, `simctl io screenshot`, `simctl get_app_container`,
`simctl spawn`). Those command lines and their flags are documented, factual
interfaces; no upstream source code was read, vendored or derived.

The survey that considered upstream MCP servers and rejected them as bases is
recorded in `.agents/specs/plugin-backfill-openbase-survey.md`. The strongest
candidate (`AlexGlkov/claude-in-mobile`) ships no license; the Apache-2.0
candidate (`BariBariGood/manzanas`) solves a different problem (fleet
orchestration, not single-simulator control).

## skills/, commands/, templates/ — original work

`skills/ios-dev/SKILL.md`, `commands/ios-dev.md` and
`templates/swiftui-app/README.md` are original work written from public
documentation (Apple's `simctl` help, the Xcode build settings) and from the
tool surface this plugin's MCP server actually exposes. They are covered by
the repository's root Apache-2.0 license, with the manifests reading `MIT` to
match the plugin family.

## hooks/hooks.json

An empty hook registration, matching the plugin contract. No third-party
content.
