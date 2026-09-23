---
description: Build, run and drive an iOS app on a simulator through the ios-dev skill.
argument-hint: "[scheme or bundle id]"
skills: ios-dev
---

Use the `ios-dev` skill for this request.

$ARGUMENTS

Anything after the command name is treated as the task selector, not as tool
flags. Map it as follows:

- nothing → the default workflow in the skill: check Xcode, pick a device,
  build, install, launch, screenshot.
- a scheme name such as `MyApp` → build that scheme, then continue from the
  install step.
- a bundle id such as `com.example.app` → skip the build and go straight to
  install/launch/verify against that bundle.
- a symptom such as "the simulator will not boot" → the troubleshooting notes
  in the skill, starting with `list_devices` and `list_runtimes`.

Rules that hold regardless of the selector:

- macOS only: `simctl` ships with Xcode. When `xcrun` is missing, report it
  and stop — there is no substitute program.
- evidence before claims: a UI state is asserted only after a `screenshot`.
- a pid from `launch_app` is not a verification; the screenshot is.
