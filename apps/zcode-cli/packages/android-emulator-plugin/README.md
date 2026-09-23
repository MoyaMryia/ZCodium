# android-emulator

Build, run and drive Android apps from an agent session. The plugin ships one
MCP server (`android-emulator`) backed by the Android Debug Bridge, the
`android-dev` skill that documents how to use it, an `android-dev` command, and
a Compose starter template.

## Layout

```
.zcodium-plugin/plugin.json    plugin manifest: skills + commands + MCP server + userConfig
.mcp.json                     the same server declaration for Claude-style hosts
skills/android-dev/           SKILL.md (tool surface + workflow) and INSTALL_ENVIRONMENT.md
commands/android-dev.md       /android-dev entry point
hooks/hooks.json              empty registration (no hooks yet)
scripts/mcp/server.mjs        the MCP server: stdio JSON-RPC, 18 ADB-backed tools
templates/compose-app/        a minimal Compose starter
NOTICE.md                     third-party notices
```

## Tools

`list_devices`, `wait_for_device`, `install_apk`, `uninstall`, `launch_app`,
`stop_app`, `tap`, `swipe`, `input_text`, `key_event`, `screenshot`,
`dump_ui`, `logcat`, `list_avds`, `start_avd`, `stop_avd`, `current_focus`,
`shell`. The tool table at the top of `scripts/mcp/server.mjs` is the whole
contract; `skills/android-dev/SKILL.md` documents when to use each.

## Requirements

A JDK, the Android SDK with `platform-tools` and `emulator` on `PATH` (or the
`adb_path` / `emulator_path` settings pointing at them), and a device or AVD.
`skills/android-dev/INSTALL_ENVIRONMENT.md` is the per-platform install path.
When something is missing the tools report it — the plugin does not substitute
another program.

## Running the server by hand

```bash
node scripts/mcp/server.mjs        # speaks newline-delimited JSON-RPC on stdio
```

Point `ANDROID_PLUGIN_ADB` at an `adb` to test against a non-default SDK.
