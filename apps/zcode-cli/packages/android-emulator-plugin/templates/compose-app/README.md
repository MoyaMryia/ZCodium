# Jetpack Compose app template

A minimal Compose project the android-dev skill can build, install and drive
without further setup. It is a starting point, not a framework — the point is
that the first build works before anything clever is added.

## What it contains

```
app/
  build.gradle.kts          applicationId, compileSdk 35, minSdk 24, Compose BOM
  src/main/AndroidManifest.xml   single Activity, no permissions beyond none
  src/main/java/.../MainActivity.kt   setContent { Greeting() }
  src/main/java/.../ui/theme/   the default Material 3 theme
```

No network, storage, camera or location permissions — a template that asks for
permissions on first run trains the user to accept prompts.

## Generate it

The structure above is what the Android Studio "Empty Activity" template
produces. To create it from the command line, copy an existing project and
change three things: `applicationId` in `app/build.gradle.kts`, the package
directories under `src/main/java/`, and the app name in
`app/src/main/res/values/strings.xml`.

## Build and run

```bash
./gradlew :app:assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Then install and launch through the skill's MCP tools (`install_apk`,
`launch_app`), and verify with `current_focus`.

## Conventions the skill assumes

- `applicationId` is the package the MCP tools address; `launch_app` takes it,
  not the module name.
- Debug builds only: `assembleDebug` produces an installable, debuggable APK
  without a signing config.
- The launcher activity is the one with `android.intent.category.LAUNDER` in
  the manifest — the skill's `launch_app` finds it through the monkey launcher
  intent, which requires exactly one.

## Extending it

Add a dependency, rebuild, reinstall. When the app grows past one module, keep
`:app` as the installable module and put libraries behind it — the skill's
workflow installs one APK from one module.
