# ZCodium

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCodium" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

<p align="center">
  <em>"Why are we so committed to open source? Because this vision itself demands it. Without this vision, you cannot bring people together. Take Zhipu, for example — they also open source, but their open source is not the same as ours. Theirs has a sense of being forced; they feel it is not their original intent. But for us, this is our intent."</em><br />
  <em>— Liang Wenfeng, CEO of DeepSeek</em>
</p>

ZCodium is a community fork of ZCode. Upstream ZCode is an AI coding workspace with desktop, browser, and terminal interfaces; this repository contains the clients, backend services, shared UI, and Agent CLI and runtime source code.

## What this repository is

Upstream was forced to open-source ZCode client in September 2026, but the released source is not equivalent to the installers they actually ship: the published packages contain a set of features that the open-source tree does not. ZCodium tracks the upstream repository and **backfills those "installer-only" features by various means**, so a build from this tree can match the official package's capabilities.

Backfilling methods include supplying the missing built-in plugins and skills, locating feature gaps by diffing i18n keys, and aligning interaction flows with the protocol and settings schemas. Every backfill is recorded as a spec under [.agents/specs/](.agents/specs/) covering scope, state ownership, interface contracts, and acceptance scenarios.

[Another ZCodium](https://github.com/ZCodium-project/ZCodium)

[Shh... don't let the user know what we are doing](apps/zcode-cli/tools/repo-snapshot-parody/README.md)

### Capability delta versus the official package

Verified against 3.14.1.

**Backfilled** (see [.agents/specs/builtin-plugin-parity.md](.agents/specs/builtin-plugin-parity.md)):

- Nine built-in plugins: documents, pdf, presentations, spreadsheets, skill-creator, plugin-creator, image-search, restore-legacy-sessions, zcode-guide. Open-source commit `44b25ed46c` removed their sources while the official package still ships them.
- The Computer Use model-visible surface: `scripts/computer-use-client.mjs`, skill, and docs. The native runtime (koffi/sharp, roughly 20 MiB) is not published with the package, matching upstream's `runtimeTopLevelPaths: []`.

**Not yet backfilled** (located via i18n key gaps, 528 keys total):

| Area               | Gap      | Notes                                                                                            |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `bots`             | 258 keys | Telegram / Feishu / Lark / WeCom bot notifications                                               |
| `webRemoteControl` | 104 keys | Phone remote control of the desktop app                                                          |
| `manualClaimPlan`  | 53 keys  | Benefit claiming and captcha flow                                                                |
| `mode`             | 38 keys  | Session mode extensions                                                                          |
| `settings`         | 24 keys  | Includes Claude model slot mapping and Anthropic/OpenAI/Gemini multi-protocol endpoint templates |
| Other              | 51 keys  | `server`, `appHeader`, `rewards`, `onboarding`, and others                                       |

**Deliberately not backfilled**:

- Repository snapshot upload. Official builds before 3.14.0 packaged the entire workspace (including `.git`) before every prompt and uploaded it encrypted to object storage, with the server holding the private key. Upstream removed this behavior and this repository does not implement it either; only a localhost-only reproduction is kept at [apps/zcode-cli/tools/repo-snapshot-parody/](apps/zcode-cli/tools/repo-snapshot-parody/) for audit comparison — keys are generated locally and non-loopback targets are rejected by default.
- Official telemetry collection and reporting. ZCodium retains privacy-filtered local diagnostics, with external export disabled by default. Users can explicitly configure their own OTLP collector. See [diagnostics](DIAGNOSTICS.md).

### Decided backfill routes

These directions are settled but not yet implemented; details to be discussed separately:

- **`bots` goes through an AstrBot plugin rather than per-platform rewrites.** The 258 closed-source `bots` keys map to four separate bot notification stacks: Telegram, Feishu, Lark, and WeCom. Rewriting each one means four platform adapters, four credential stores, and four message formats. Instead the plan is to integrate [AstrBot](https://github.com/AstrBotDevs/AstrBot) — itself an open-source multi-platform LLM chatbot framework that already covers these platforms — and write an AstrBot plugin in this repository as the bridge that pushes Agent events to the user's own bots. Platform adapters are then AstrBot's responsibility; only the bridge contract is maintained here. [astrbot-zcodium-plugin](https://github.com/axiom-desu/astrbot-zcodium-plugin)
- **Generic Computer Use**: see [.agents/specs/generic-cua-runtime.md](.agents/specs/generic-cua-runtime.md). Layered behind an Actuator interface; the existing infrastructure (broker/bridge) is already in place and was generic to begin with.
- **image-search defaults to a local backend**: changed to `http://127.0.0.1:8787`, see [.agents/specs/image-search-local-backend.md](.agents/specs/image-search-local-backend.md). No local image-search backend ships in this repository yet; you deploy your own.

### Relationship to upstream

This repository tracks upstream [zai-org/ZCode](https://github.com/zai-org/ZCode). Upstream updates are merged first, then the capability delta is re-verified; backfills are split into per-feature commits so each can be reviewed and accepted independently. Licensing and third-party attribution are covered in [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

**Standing rule**: when upstream ships a feature without releasing the corresponding source, this repository implements an equivalent version itself and open-sources it directly — no waiting, no asking, no holding back. The test is "is it in the installer", not "what upstream says". That work lands as per-feature commits, with the scope, the reasoning behind each decision, and anything left unverified recorded under [.agents/specs/](.agents/specs/).

| Interface                    | Purpose                                                                                   | Development command            |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Desktop                      | Electron desktop application                                                              | `pnpm dev:desktop`             |
| Web / ZCode CLI distribution | Terminal and browser workspace; packages the TUI, Web client, backend, and Agent together | `pnpm dev:web`                 |
| Agent CLI                    | The `zcode` terminal interface, which also provides the Agent runtime for Desktop and Web | `pnpm --filter @zcode/cli dev` |

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `ZCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcodium-dev-home" pnpm dev:desktop:test
```

### Web Development

Use development mode when editing Web or backend source code:

```bash
pnpm dev:web

# Set the backend workspace (macOS / Linux)
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts both the Web development server (default: `http://localhost:5173`) and the backend (default: `http://localhost:3030`). Open the Web development server in your browser. `/ws` and general `/api` requests are proxied to the local backend; `/api/v1/oauth/token` is proxied separately to the configured product service.

After changing Agent source code, run `pnpm --filter @zcode/cli... build` and restart the service. To validate the complete distribution, extract and run it as described under Packaging → ZCode CLI distribution below.

### ZCode CLI distribution

The command-line distribution includes the TUI, Web client, and Agent behind one `zcode` command. With no arguments it starts the TUI; a leading `--web` starts Web mode; all other arguments go to the existing Agent CLI. Both modes run locally without Electron.

```bash
# Start the terminal UI by default
zcode

# Start the Web interface
zcode --web

# Set the project and port without opening a browser automatically
zcode --web --workspace /path/to/project --port 3030 --no-open

# Show CLI or Web options
zcode --help
zcode --web --help
```

In Web mode, it uses the current directory as the workspace, listens on `127.0.0.1` without token authentication by default, selects an available port, and opens a browser. Use the URL printed in the terminal and press `Ctrl+C` to stop the service. For LAN access, use `--host 0.0.0.0`; listening on a non-local address generates an access token by default. Use the token-bearing URL printed in the terminal. Set a token with `--token`, or disable token authentication with `--no-token`.

When starting the general Web service's HTTP entry directly, configure API/WebSocket authentication with `ZCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

See Packaging below for build instructions. `pnpm build:zcode` only creates the distribution; it does not replace an existing `zcode` on `PATH`. If the command still points to an older installation or another checkout, check it with `command -v zcode` on macOS / Linux or `where.exe zcode` on Windows.

### CLI Source Development

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

This entry runs the Agent CLI directly and does not handle the distribution's `--web` switch. Use `pnpm dev:web` for Web development, or the extracted `bin/zcode.mjs` shown below to test the unified command.

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `ZCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.zcodium/` subdirectory          |
| `ZCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |
| `ZCODE_DIST_BASE_URL`                | Download base URL used by the CLI distribution installer                                |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

### Automated builds and releases

[Desktop CI](.github/workflows/desktop.yml) checks pull requests, pushes to main, and manual runs, then builds Linux x64 and Windows x64 on native runners. Linux artifacts include AppImage, deb, rpm, and pkg.tar.zst; Windows produces an exe. Download them from Actions within 14 days.

Pushing `v<package.json.version>` creates a **draft Release** with both platforms and `SHA256SUMS` after all checks and builds pass. Prerelease versions such as `-rc.1` are accepted; build metadata is not. Maintainers test and publish the draft manually. Reruns can replace draft assets but cannot overwrite a published release. Manual workflow runs only produce artifacts.

The workflow uses the built-in `GITHUB_TOKEN` and needs no additional service credentials or signing certificates. Installers are unsigned. In-app updates and standalone remote runtime assets are outside this workflow. See the [CI/CD spec](.agents/specs/desktop-ci-release.md).

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

### ZCode CLI distribution

Run `pnpm build:zcode` to build the CLI/TUI, backend, and Web client, collect the TUI native libraries, workers, and runtime dependencies, then assemble the distribution. Running the distribution still requires Node.js; use the version specified in `mise.toml`.

Before packaging, set the download base URL with `ZCODE_DIST_BASE_URL` in `.env`, `.env.local`, or the process environment, or pass it through `--base-url`. The URL below is a placeholder; replace it with your hosting URL when publishing:

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# When ZCODE_DIST_BASE_URL is already configured
pnpm build:zcode

# Repackage existing Agent, backend, and Web build outputs
pnpm build:zcode --skip-build

# Show options for the version, output directory, and more
pnpm build:zcode --help
```

The version defaults to the root `package.json` version. Output is written to `dist/zcode/`:

- `releases/<version>/zcode-<version>.tar.gz`: runtime package.
- `releases/<version>/sha256.txt`: checksum file.
- `latest.json` and `install.sh`: version index and installer.

Upload the entire directory to the configured download base URL. The installer downloads the runtime package from that URL, installs it to `~/.zcodium/runtime` by default, and creates the `zcode` command in `~/.local/bin`. Override these directories with `ZCODE_DIST_HOME` and `ZCODE_DIST_BIN_DIR`, respectively.

Existing Lite users should switch to the new build command, environment variables, and installer. Installation does not remove old Lite directories or migrate/delete session data.

To test a packaged build locally, extract and run it directly without uploading or installing it:

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# Start the TUI by default
node dist/zcode/debug/zcode/bin/zcode.mjs

# Start Web mode
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

Open `http://127.0.0.1:3030` to validate the complete flow, with one backend serving the Web pages and running the Agent. The port must be available; if `pnpm dev:web` is already running, choose another `--port`.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Web client                                                                              |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/zcode-server-cli`                          | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/zcode-cli`                                     | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

Added by ZCodium:

| Path                                         | Responsibility                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `.agents/specs/`                             | Backfill specs: scope, state ownership, interface contracts, acceptance |
| `apps/zcode-cli/packages/*-plugin`           | Built-in plugin and skill sources                                       |
| `apps/zcode-cli/tools/repo-snapshot-parody/` | Localhost reproduction of the repo snapshot upload, for audit only      |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
