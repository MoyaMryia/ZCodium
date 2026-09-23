# SwiftUI app template

A minimal SwiftUI project the ios-dev skill can build, install and drive
without further setup. A starting point, not a framework — the point is that
the first build works before anything clever is added.

## What it contains

```
MyApp/
  MyApp.xcodeproj          single target, automatic signing off
  MyAppApp.swift           @main, WindowGroup { ContentView() }
  ContentView.swift        a VStack with a title and one button
  Assets.xcassets/         the default accent color
  Info.plist               nothing beyond the generated defaults
```

No network, location, notification or photo-library usage descriptions — a
template that asks for permissions on first run trains the user to accept
prompts.

## Generate it

The structure above is what Xcode's "iOS App" template produces. From the
command line, the equivalent is a `Package.swift`-based SwiftPM executable for
logic, plus an Xcode project for anything that needs a simulator `.app` — the
skill installs `.app` bundles, so the project must produce one.

## Build

```bash
xcodebuild -scheme MyApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -derivedDataPath .build build
# .build/Build/Products/Debug-iphonesimulator/MyApp.app
```

Then install and launch through the skill's MCP tools (`install_app`,
`launch_app`) and verify with `screenshot`.

## Conventions the skill assumes

- The **bundle id** is what the MCP tools address; the scheme is what the
  build addresses. Both are needed and they are not the same string.
- Debug builds for simulator destinations; a device destination needs a
  signing team the project already has.
- Exactly one launchable target — `launch_app` takes a bundle id, and an app
  with several targets makes the mapping ambiguous.

## Extending it

Add a Swift Package dependency, rebuild, reinstall. When the app grows past a
handful of files, split by feature folder before splitting by module — the
skill's workflow installs one `.app` from one scheme.
