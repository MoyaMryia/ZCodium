---
name: ios-dev
description: Use when the task involves an iOS app or simulator — building one, running one, driving one, or verifying one. Covers the MCP tool surface this plugin exposes over xcrun simctl (devices, boot lifecycle, install, launch, screenshots, deep links, appearance, spawn), the Xcode build path, and the macOS-only environment the whole chain needs. Trigger on requests to build, run, test, debug or screenshot an iOS app, to automate the simulator, or on symptoms such as a simulator not booting, an install failing, a launch that does nothing, or a build that cannot find a scheme.
---

# iOS Dev

Build, run and drive iOS apps from the agent session. This plugin exposes one
MCP server (`ios-simulator`) backed by `xcrun simctl`; the skill below is how
to use it well.

**Platform: macOS with Xcode installed.** `simctl` ships with Xcode; there is no
Linux or Windows path. Every tool reports that clearly when `xcrun` is missing
rather than pretending a simulator exists.

## Tool surface

All tools come from the `ios-simulator` MCP server. Devices are addressed by
name (as `list_devices` reports it) or UDID; the name is usually easier.

| tool | what it does | notes |
| --- | --- | --- |
| `list_devices` | available simulators with name, UDID, state, runtime | the first command of every session |
| `list_runtimes` | installed simulator runtimes and versions | when a device type is unavailable |
| `boot` / `shutdown` | simulator lifecycle | `boot` waits for readiness |
| `erase` | factory-reset a simulator | shuts down first |
| `create_device` | create one from a device type + runtime | identifiers from `list_runtimes` |
| `install_app` / `uninstall_app` | `.app` bundle in/out | needs a host-side `.app` path |
| `launch_app` / `terminate_app` | by bundle id | `launch_app` returns the pid |
| `screenshot` | capture to a host PNG | the primary visual evidence |
| `open_url` | URL or custom scheme | deep links, universal links |
| `get_container` | an app's container path on the host | inspect app/data containers |
| `set_appearance` | light/dark | dark-mode verification |
| `spawn` | run a command inside the simulator | escape hatch |

## Default workflow

1. **Environment first.** `xcrun simctl list devices` must answer. If `xcrun`
   is missing, Xcode (or the Command Line Tools) is not installed — report it
   and stop; there is no substitute.
2. **`list_devices`**, then `boot` the device you want (by name, e.g.
   `iPhone 16`). If the name you want is unavailable, `list_runtimes` explains
   why — usually a runtime that is not installed.
3. **Build** on the host: `xcodebuild -scheme <Scheme> -destination 'platform=iOS Simulator,name=<Device>' build` (or open the project and build). The `.app` lands in the derived data's `Build/Products/Debug-iphonesimulator/`.
4. **`install_app`** with that path. A bundle identifier conflict means an
   older build is installed — `uninstall_app` first.
5. **`launch_app`** with the bundle id, then **`screenshot`** to see it. There
   is no `current_focus` on iOS: the screenshot is the evidence that the launch
   happened, and a launch that returns a pid but shows the home screen means
   the app crashed on start — check the device log with `spawn log show`.
6. **Drive and verify.** `open_url` for deep links, `set_appearance` for
   dark mode, `screenshot` after each state change. Never claim a UI state
   without a screenshot.
7. **Finish.** `terminate_app`; leave the simulator booted only if the user is
   still iterating. `erase` before a clean-state run.

## Tool notes

- **Device names are not unique across runtimes.** `list_devices` reports the
  runtime per device; when two entries share a name, address by UDID.
- **`launch_app` returns a pid**, not a success guarantee. The pid plus a
  screenshot is the verification; the pid alone is not.
- **`spawn` runs inside the simulator's environment** — `spawn log show
  --last 1m --predicate 'process == "<bundle>"'` is how you read a crash
  without opening Console.
- **`get_container` needs the app installed**; it fails on an unknown bundle id.
- **Deep links need the scheme registered** in `Info.plist` before `open_url`
  can reach the app — an unhandled URL opens Safari instead.

## Extension point

Anything `simctl` can do that is not covered is reachable through `spawn` (for
in-simulator commands) or by adding a typed tool to
`scripts/mcp/server.mjs` — the tool table at the top of that file is the whole
contract — and documenting it here. Gesture-level interaction (taps, swipes,
text entry) is deliberately out of scope: this plugin's tools cover lifecycle
and verification, and the `ui_backend` setting names the external tool (idb,
xcodebuildmcp) to use when a task needs gestures.
