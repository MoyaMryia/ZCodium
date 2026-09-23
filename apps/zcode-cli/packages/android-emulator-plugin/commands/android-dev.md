---
description: Build, run and drive an Android app on an emulator or device through the android-dev skill.
argument-hint: "[gradle task or app package]"
skills: android-dev
---

Use the `android-dev` skill for this request.

$ARGUMENTS

Anything after the command name is treated as the task selector, not as tool
flags. Map it as follows:

- nothing → the default workflow in the skill: check the environment, pick a
  device, build, install, launch, verify.
- a Gradle task such as `assembleDebug` or `installDebug` → run that task on
  the host, then continue from the install step.
- an application id such as `com.example.app` → skip the build and go straight
  to install/launch/verify against that package.
- a symptom such as "the device does not show up" → the troubleshooting table
  in the skill, starting with `list_devices`.

Rules that hold regardless of the selector:

- evidence before claims: a UI state is asserted only after `current_focus`,
  `dump_ui` or a `screenshot` says so.
- never guess coordinates; take them from `dump_ui`.
- when a tool is missing, report it and stop — do not substitute another
  program or skip the verification step.
