# Installing the Android environment

What the android-dev skill needs on the machine, how to check it, and how to
install what is missing. Nothing here is a workaround: when a piece is absent
the skill reports it and stops, it does not pretend.

## The pieces

| piece | why | how it arrives |
| --- | --- | --- |
| JDK (17 by default) | Gradle and the Android Gradle Plugin run on it | Adoptium/Temurin, or the OS package |
| Android SDK | platform, build-tools, platform-tools | `sdkmanager` from the command-line tools |
| `adb` on `PATH` | every MCP tool shells out to it | ships in `platform-tools` |
| `emulator` on `PATH` | AVD lifecycle tools | ships in `emulator`, plus a system image |
| A system image | the thing an AVD boots | `sdkmanager "system-images;...;default;abi"` |

## Check

```bash
java -version 2>&1 | head -1          # JDK, major version
adb version                           # platform-tools
emulator -list-avds                   # emulator + AVDs
echo "$ANDROID_HOME"                  # SDK root, if set
ls "$ANDROID_HOME/platforms" 2>/dev/null   # installed platforms
```

The plugin's `adb_path` / `emulator_path` settings accept a bare name (resolved
on `PATH`) or an absolute path — set them when the SDK is not on `PATH`.

## Install, per platform

**macOS**

```bash
brew install --cask temurin            # JDK
brew install --cask android-command-tools
export ANDROID_HOME="$HOME/Library/Android/sdk"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" "system-images;android-35;default;arm64-v8a"
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n medium_phone -k "system-images;android-35;default;arm64-v8a" -d medium_phone
```

**Linux (Debian/Ubuntu)**

```bash
sudo apt install openjdk-17-jdk unzip
mkdir -p ~/android-sdk && cd ~/android-sdk
curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip && mkdir -p cmdline-tools/latest
# then the same sdkmanager/avdmanager sequence as macOS with ANDROID_HOME=~/android-sdk
```

KVM (`/dev/kvm` present and your user in the `kvm` group) is what makes the
x86_64 emulator usable on Linux; without it the emulator runs but is unusably
slow. On ARM hosts use the `arm64-v8a` system image instead.

**Windows**

Install the JDK and the "command line tools only" package from the Android
developer site, then run the same `sdkmanager`/`avdmanager` sequence from
PowerShell with `ANDROID_HOME` set. The emulator needs hardware acceleration
(Hypervisor Platform / WHPX or Intel HAXM); without it, prefer a physical
device with USB debugging.

## API level and images

The plugin's defaults (`api_level` 35, `build_tools_version` 35.0.0, variant
`default`) are a coherent set. Change them together: an app targeting API 35
needs `platforms;android-35`, and an AVD can only boot a system image it has.
ABI follows the host — `arm64-v8a` on Apple Silicon and ARM Linux, `x86_64`
elsewhere — and the `system_image_abi` setting overrides it when you know
better.

## Verifying

```bash
adb devices            # a device or emulator listed, state "device"
adb shell getprop ro.build.version.sdk   # the API level actually running
```

Both must answer before the skill's workflow is usable. A device in state
`unauthorized` means the RSA prompt on the device was not accepted; `offline`
usually means a half-booted emulator.

## Configurable defaults

The plugin's `userConfig` supplies these; every command below reads them, and
changing a default means changing them together:

| setting | default | what it drives |
| --- | --- | --- |
| `sdk_path` | (empty → `ANDROID_HOME`/`ANDROID_SDK_ROOT`) | where `adb`/`emulator`/`sdkmanager` are looked up |
| `adb_path` / `emulator_path` | `adb` / `emulator` | bare name on `PATH`, or an absolute path |
| `default_avd` | `medium_phone` | which device `start_avd` boots |
| `api_level` | `35` | the platform to install and target |
| `build_tools_version` | `35.0.0` | the build-tools package |
| `system_image_variant` | `default` | `default` / `google_apis` / `google_apis_playstore` |
| `system_image_abi` | (host-derived) | `arm64-v8a` on Apple Silicon/ARM, else `x86_64` |
| `jdk_major` | `17` | the JDK the preflight expects |

**Guardrails** — the checks that run before anything is installed:

- `java -version` reports a JDK at or above `jdk_major`.
- `adb version` answers (platform-tools installed).
- `emulator -list-avds` answers and lists at least one AVD.
- The ABI of the installed system image matches the host — an x86_64 image on
  an ARM Mac boots (slowly, through Rosetta) or does not boot at all depending
  on the macOS version; the arm64 image is the correct default there.
- Disk space: a system image plus the AVD's userdata is ~2–4 GB. A full disk
  produces "the emulator will not start" reports that are really disk reports.

## Quick fix: Gradle not found

The most common first-build failure, and it is not an SDK problem:

- **Symptom**: `./gradlew: Permission denied` or `gradlew: command not found`
  — or, on Windows, `./gradlew is not recognized`.
- **Fix**: the wrapper script is not executable (`chmod +x gradlew`), or the
  project has no wrapper (`gradle wrapper` once, with a system Gradle), or the
  shell cannot see it (`bash gradlew` instead of `./gradlew`).
- The wrapper is the supported path: it pins the Gradle version per project.
  A system Gradle and the wrapper disagreeing produces builds that work on one
  machine and fail on another.

## macOS — the full sequence

### Detect current state

```bash
java -version 2>&1 | head -1
adb version 2>/dev/null || echo "no adb"
emulator -list-avds 2>/dev/null || echo "no emulator"
echo "ANDROID_HOME=${ANDROID_HOME:-unset}"
ls ~/Library/Android/sdk 2>/dev/null || echo "no default SDK dir"
```

### Install the JDK

```bash
brew install --cask temurin        # or: openjdk@17
```

Verify the major version matches `jdk_major`. A newer JDK than the Android
Gradle Plugin supports is the cause of `Unsupported class file major version`
— the fix is the JDK version, not the plugin.

### Install Gradle (optional)

The wrapper (§Quick fix) is preferred. When a system Gradle is wanted:
`brew install gradle`.

### Install the Android command-line tools

```bash
brew install --cask android-command-tools
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

### Install SDK packages

```bash
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "emulator" \
  "system-images;android-35;default;arm64-v8a"
```

Accept the licences first — a package install without accepted licences fails
at the build, not at the install, which is the confusing version.

### Create the AVD

```bash
"$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  -n medium_phone \
  -k "system-images;android-35;default;arm64-v8a" \
  -d medium_phone
```

The `-d` device profile and the `-k` system image must both exist; a mismatch
fails at `start_avd` with a message about the image, not the profile.

## Windows — the differences

Everything above applies with three changes:

1. **Detect**: `where adb`, `where emulator`, `echo %ANDROID_HOME%`. The
   binaries live under `%LOCALAPPDATA%\Android\Sdk` by default, and a shell
   started before the install will not see them — open a new shell, or add the
   directories to `PATH`.
2. **Install**: the JDK from Adoptium, and the "command line tools only" zip
   from the Android developer site — extract it to
   `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\` (the `latest` directory
   name is what `sdkmanager` expects).
3. **Acceleration**: the emulator needs Hyper-V / WHPX (or Intel HAXM on older
   CPUs). Without it the emulator is unusably slow; a physical device with USB
   debugging is the better path on a machine without it.

## Linux — the differences

- JDK from the distribution (`openjdk-17-jdk`), command-line tools from the
  Google zip, same `sdkmanager` sequence.
- **KVM is what makes the x86_64 emulator usable**: `/dev/kvm` must exist and
  the user must be in the `kvm` group. Without it, use the `arm64-v8a` image on
  ARM hosts or a physical device on x86.
- Distribution packages (`adb`, `fastboot`) are often older than
  platform-tools; prefer the SDK's own copies and put them first on `PATH`.
