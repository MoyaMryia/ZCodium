# ios-simulator

Build, run and drive iOS apps from an agent session. The plugin ships one MCP
server (`ios-simulator`) backed by `xcrun simctl`, the `ios-dev` skill that
documents how to use it, an `ios-dev` command, and a SwiftUI starter template.

**macOS with Xcode only.** `simctl` ships with Xcode; there is no Linux or
Windows path, and the tools say so when `xcrun` is missing.

## Layout

```
.zcodium-plugin/plugin.json    plugin manifest: skills + commands + MCP server + userConfig
.mcp.json                     the same server declaration for Claude-style hosts
skills/ios-dev/SKILL.md       tool surface + workflow
commands/ios-dev.md           /ios-dev entry point
hooks/hooks.json              empty registration (no hooks yet)
scripts/mcp/server.mjs        the MCP server: stdio JSON-RPC, 15 simctl-backed tools
templates/swiftui-app/        a minimal SwiftUI starter
NOTICE.md                     third-party notices
```

## Tools

`list_devices`, `list_runtimes`, `boot`, `shutdown`, `erase`, `create_device`,
`install_app`, `uninstall_app`, `launch_app`, `terminate_app`, `screenshot`,
`open_url`, `get_container`, `set_appearance`, `spawn`. The tool table at the
top of `scripts/mcp/server.mjs` is the whole contract;
`skills/ios-dev/SKILL.md` documents when to use each.

## Deliberately out of scope

Gesture-level interaction (taps, swipes, text entry). This plugin covers
lifecycle, install, launch, deep links and verification; the `ui_backend`
setting names the external tool (`idb`, `xcodebuildmcp`) to use when a task
needs gestures. Screenshots are the visual evidence, not a substitute for a
gesture driver.

## Running the server by hand

```bash
node scripts/mcp/server.mjs        # speaks newline-delimited JSON-RPC on stdio
```
