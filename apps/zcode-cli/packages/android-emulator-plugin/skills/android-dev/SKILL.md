---
name: android-dev
description: Use when the task involves an Android app or emulator — building one, running one, driving one, or verifying one. Covers the MCP tool surface this plugin exposes over ADB (devices, install, launch, input, screenshots, UI dumps, logcat, AVD lifecycle), the Gradle build path, and the environment the whole chain needs (JDK, Android SDK, platform tools, a running device or AVD). Trigger on requests to build, run, test, debug or screenshot an Android app, to automate the emulator, or on symptoms such as a device not appearing, an install failing, a launch that does nothing, or a build that cannot find the SDK.
---

# Android Dev

Build, run and drive Android apps from the agent session. This plugin exposes
one MCP server (`android-emulator`) backed by the Android Debug Bridge; the
skill below is how to use it well.

## Tool surface

All tools come from the `android-emulator` MCP server. Coordinates are absolute
screen pixels; get them from `dump_ui` or a `screenshot`, never by guessing.

| tool | what it does | notes |
| --- | --- | --- |
| `list_devices` | attached devices and emulators with state | the first command of every session |
| `wait_for_device` | block until a device is online | after a boot or a replug |
| `install_apk` | install/reinstall keeping data | `-r -d`; needs a host-side `.apk` path |
| `uninstall` | remove a package by application id | |
| `launch_app` | start an app by package id | via the launcher activity |
| `stop_app` | force-stop a package | |
| `tap` / `swipe` / `input_text` / `key_event` | input injection | `input_text` escapes spaces as `%s` |
| `screenshot` | capture the screen to a host PNG | returns the path |
| `dump_ui` | view hierarchy as XML on the host | the reliable way to find coordinates |
| `current_focus` | the focused window and activity | the check that a launch happened |
| `logcat` | recent log lines (`-d`) | filter by `tag:priority` |
| `list_avds` / `start_avd` / `stop_avd` | AVD lifecycle | `start_avd` waits for boot |
| `shell` | arbitrary `adb shell` | escape hatch; prefer the typed tools |

## Default workflow

1. **Environment first.** Run `INSTALL_ENVIRONMENT.md`'s check: JDK, SDK,
   platform-tools on `PATH`, a device or AVD available. A missing tool is
   reported, not worked around.
2. **`list_devices`.** If it is empty, `list_avds` then `start_avd` (or tell the
   user to plug in a device), then `wait_for_device`.
3. **Build** on the host: `./gradlew :app:assembleDebug` (or
   `installDebug`). The APK lands in `app/build/outputs/apk/debug/`.
4. **`install_apk`** with that path. On failure read the message: signature
   conflicts need an uninstall first; ABI mismatches need the right system
   image; `INSTALL_FAILED_UPDATE_INCOMPATIBLE` is a debug-vs-release conflict.
5. **`launch_app`** with the application id, then **`current_focus`** to confirm
   the app is actually in the foreground — a launch that returns success but
   leaves the launcher focused has not launched.
6. **Drive and verify.** `dump_ui` to find targets, `tap`/`input_text` to act,
   `screenshot` to see the result, `current_focus` and `logcat` when something
   is wrong. Never claim a UI state without one of these three as evidence.
7. **Finish.** `stop_app` when the session is done; leave the emulator running
   only if the user is still iterating.

## Tool notes

- **Coordinates**: `dump_ui` reports `bounds="[x1,y1][x2,y2]"` per node; tap the
  centre of the target's bounds. A tap that lands on an overlaying element does
  nothing visible — dump again after any layout change.
- **`input_text`** sends the whole string at once into the focused field; focus
  the field with a `tap` first, and remember `%s` is how spaces survive.
- **`screenshot` returns a path, not an image.** Read the file when the task
  needs the pixels.
- **`logcat`** is `-d` (dump and exit); it never streams. Clear before a run
  (`shell logcat -c`) when you want a clean trace.
- **`shell`** exists for everything else, but a typed tool that does the job is
  preferred — it keeps the transcript reviewable.

## Project requirements

- A Gradle project with an `applicationId`; the plugin never invents one.
- `compileSdk`/`targetSdk` at or below the device's API level; a device on API
  34 cannot install an app targeting a newer SDK without the matching platform.
- Debug builds for anything driven from here; release builds need a signing
  config the project already has.
- Minifying/dexdknife steps that rewrite the APK after `assembleDebug` break
  the install path — install the APK Gradle produced.

## Build troubleshooting

| symptom | first check |
| --- | --- |
| `SDK location not found` | `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or `local.properties` `sdk.dir` |
| `Could not resolve com.android.tools.build:gradle` | network/Gradle proxy, not the SDK |
| `Unsupported class file major version` | JDK newer than the Gradle version supports; use the configured `jdk_major` |
| device not in `list_devices` | USB debugging authorised; `adb kill-server` then retry |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | emulator has no room; wipe data or pick a bigger AVD |
| app installs but does not launch | wrong application id, or no launcher activity |

## Extension point

The tool set is deliberately small. Anything ADB can do that is not covered is
reachable through `shell`; when a need recurs, add a typed tool to
`scripts/mcp/server.mjs` (the tool table at the top of that file is the whole
contract) and document it here — never drive the MCP server through ad-hoc
scripts outside this plugin.
