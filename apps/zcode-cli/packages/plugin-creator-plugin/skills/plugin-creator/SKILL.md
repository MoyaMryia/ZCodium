---
name: plugin-creator
description: Author, validate and locally test ZCode plugins. Use when creating a new plugin (skills, commands, hooks or MCP servers), changing an existing plugin's manifest or components, preparing a local dev marketplace to try a plugin before publishing, or diagnosing why a plugin will not add, install, update or load. Covers `.zcodium-plugin/plugin.json`, the five bundled scripts, and the manual add/install/update handoff in the app.
---

# Plugin Creator

Produce plugin source ZCode can load, prove it with the bundled checks, and leave the user a precise set of UI steps to add the market, install, update and try the plugin. This skill writes files only — registration, installation and enabling stay with the user in the app.

## 1. Boundaries

- The handoff is manual by design. Do not register marketplaces, install, enable, update or publish plugins; report those steps as pending until the user confirms them.
- Do not assume a global `zcode` CLI, or even `node`, on the user's machine. Every script below is optional; the file-tools path is always valid.
- A skill reference is not a plugin. If the request is only "write me a SKILL.md", ask what the plugin should do before generating any files.
- Public release is out of scope. Local testing through a dev marketplace is the whole target here.

## 2. The five bundled scripts

All live in `scripts/` next to this file. Three have CLI entries; two are libraries with no entry point.

| script                       | entry   | responsibility                                                                                          |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `create-basic-plugin.mjs`    | CLI     | Writes a plugin scaffold (manifest plus declared components), optionally appending a marketplace entry. |
| `scaffold-files.mjs`         | library | `scaffoldFiles(name, components)` returns the file map (path to contents). Performs no I/O.             |
| `marketplace-files.mjs`      | library | Marketplace catalog safety layer: containment checks, plan computation, atomic write, file lock.        |
| `validate-plugin.mjs`        | CLI     | Runs its own preflight, then delegates schema validation to `zcode plugins validate`.                   |
| `upsert-dev-marketplace.mjs` | CLI     | Registers or refreshes one plugin in the local dev marketplace and prints the resulting IDs.            |

Call graph:

```text
create-basic-plugin.mjs    -> scaffold-files.mjs        (scaffoldFiles)
                           -> marketplace-files.mjs     (exists, rejectSymlink,
                                                          marketplacePlan, atomicJson,
                                                          withMarketplaceLock)
validate-plugin.mjs        -> marketplace-files.mjs     (escapesRoot)
upsert-dev-marketplace.mjs -> create-basic-plugin.mjs   (normalizePluginName)
                           -> marketplace-files.mjs     (same four helpers)
                           -> validate-plugin.mjs       (preflightPlugin)
```

The three CLI entries print `error.message` to stderr and exit `1` on any failure; success exits `0`.

## 3. `create-basic-plugin.mjs`

```bash
node scripts/create-basic-plugin.mjs <name> [--path parent] [--with-skills] [--with-commands] [--with-hooks] [--with-mcp] [--with-scripts] [--with-assets] [--marketplace-path file] [--force]
```

- `<name>` is normalized before use: path separators are rejected, the input is lowercased, runs of non-alphanumerics collapse to a single hyphen, edge hyphens are trimmed, and the result must be 1–64 characters. The directory name is the normalized name, so `My Plugin!` becomes `my-plugin`.
- `--path` sets the parent directory; the default is `./plugins` under the current working directory.
- Component flags are all boolean, default off:

| flag              | files produced                                  | manifest field written          |
| ----------------- | ----------------------------------------------- | ------------------------------- |
| `--with-skills`   | `skills/<name>/SKILL.md`                        | `"skills": "./skills"`          |
| `--with-commands` | `commands/help.md`                              | `"commands": "./commands"`      |
| `--with-hooks`    | `hooks/hooks.json`, `scripts/session-start.mjs` | `"hooks": "./hooks/hooks.json"` |
| `--with-mcp`      | `.mcp.json`, `scripts/mcp-server.mjs`           | `"mcpServers": "./.mcp.json"`   |
| `--with-scripts`  | `scripts/.gitkeep`                              | —                               |
| `--with-assets`   | `assets/.gitkeep`                               | —                               |

- `README.md` and `.zcodium-plugin/plugin.json` are always written. The manifest carries `name`, `version` `0.1.0`, `description` `<name> plugin`, `author.name` `Local developer`, plus the component fields above in the fixed order skills, commands, hooks, mcpServers — the order is fixed so identical inputs produce identical files.
- `--marketplace-path` also upserts an entry for the new plugin into that catalog (a missing file starts as `{"name":"personal","plugins":[]}`). Without the flag, no catalog is touched.
- `--force` allows overwriting an existing plugin directory, existing files, and an existing marketplace entry.
- Ordering guarantee: every check — marketplace plan, directory existence, a symlink walk over each destination's ancestors, per-file existence — runs before the first byte is written, so a rejected run leaves nothing behind.
- On success it prints `Created <root>. Customize the scaffold, then run zcode plugins validate before installation.`

Failures observed while running it (each exits `1`): `Plugin name must not contain path separators`, `Plugin name must contain 1–64 ASCII letters/digits/hyphens`, `Plugin directory already exists: <root>`, `File already exists: <path>`, `Refusing symbolic link: <path>`, `Marketplace entry already exists: <name>`, `Plugin source is outside the marketplace root`, `Invalid marketplace name or plugins array; validate the existing file first`, `Duplicate marketplace entry: <name>`, `Marketplace is busy: <file>.lock`. (`Unsupported component` exists in the code path but is unreachable from the CLI, whose flags are fixed.)

## 4. `scaffold-files.mjs` (library)

No CLI entry and no side effects. `scaffoldFiles(name, components)` returns a `Map` of plugin-relative path to file contents; `create-basic-plugin.mjs` owns the actual writing.

- Only declared components produce files. A manifest field pointing at a directory the loader would scan anyway just makes an empty plugin look larger than it is.
- Templates:
  - skill — `SKILL.md` with `name` and `description` frontmatter plus a short body.
  - command — `commands/help.md` with a `description` frontmatter.
  - hooks — `hooks/hooks.json` registers a `SessionStart` command hook running `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"`, plus a `session-start.mjs` that deliberately prints nothing. A SessionStart hook's stdout lands in every session's context, so the skeleton stays silent until a real behavior exists.
  - mcp — `.mcp.json` declares one stdio server (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs"`) and `scripts/mcp-server.mjs` implements a minimal JSON-RPC loop: `initialize` echoes the client's `protocolVersion`, `tools/list` returns `[]`, `ping` returns `{}`, anything else gets error `-32601`. An empty tool list is honest — "server up, no tools yet"; faking tools is not.
- `${CLAUDE_PLUGIN_ROOT}` is written verbatim; the loader substitutes the installed plugin root at runtime (MCP argument resolution maps both `CLAUDE_PLUGIN_ROOT` and `ZCODE_PLUGIN_ROOT`; hook command expansion does the same). Never hardcode an install-cache path.
- `scripts/` and `assets/` produce only `.gitkeep`.

## 5. `marketplace-files.mjs` (library)

No CLI entry. Every marketplace write goes through this module, because the catalog is a shared file the user also edits by hand.

- `exists(path)` — `lstat`-based, so a dangling symlink counts as present: the link itself exists even though its target does not.
- `rejectSymlink(path)` — throws `Refusing symbolic link: <path>` for a symlink, passes on ENOENT. Callers walk every ancestor: a lexically valid path can still route through a link.
- `escapesRoot(root, path)` — lexical containment test (`relative` plus an absolute check).
- `marketplacePlan(path, pluginRoot, name, force, requireSameSource = false)` — reads the manifest and returns the value that _would_ be written, without writing it. Root resolution: for `<root>/.claude-plugin/marketplace.json` the market root is the parent of `.claude-plugin`; for `<root>/marketplace.json` it is the file's own directory. A missing file starts from `{ "name": "personal", "plugins": [] }`. It validates the market name against `^[a-z0-9][a-z0-9._-]{0,127}$`, requires a `plugins` array with unique entry names, requires the plugin source to resolve inside the root, and rewrites only the matching entry as `{ ...previous, name, source: "./<relative>" }` — other entries, their order and the market name survive untouched. With `requireSameSource`, an existing same-name entry pointing at a different directory throws `Marketplace source conflict: <name>` instead of silently stealing the name.
- `atomicJson(path, value)` — writes `<path>.<pid>.tmp` with exclusive create, then renames; a reader sees the old content or the new one, never half of either.
- `withMarketplaceLock(path, operation)` — creates `<path>.lock` with exclusive create and mode `0600`; contention throws `Marketplace is busy: <path>.lock` instead of letting two processes both write from the same stale read. The lock file is always removed afterwards; one left behind by a crashed run must be deleted manually.

## 6. `validate-plugin.mjs`

```bash
node scripts/validate-plugin.mjs <plugin-path> [--cli zcode-executable-or-js-entry]
```

Two stages:

1. **Preflight** (`preflightPlugin`, also imported by `upsert-dev-marketplace.mjs`). This is deliberately not a copy of the ZCode manifest schema — it adds the two classes of problem schema validation does not cover:
   - resolves `.zcodium-plugin/plugin.json` through `realpath` and rejects a manifest symlink that escapes the plugin;
   - walks every string in the manifest for unresolved placeholders: `TODO`, `FIXME`, `<your …>`, `YOUR_API_KEY`;
   - collects resource paths from the `skills`, `commands`, `hooks` and `mcpServers` fields (string or array entries) plus any `${CLAUDE_PLUGIN_ROOT}/…` reference found inside manifest strings, then for each one resolves it inside the plugin root (escape is an error), follows symlinks (escape is an error), expands directories while skipping `node_modules` and `.git`, and scans text files (`.json`, `.md`, `.mjs`, `.cjs`, `.js`, `.ts`, `.txt`, `.yaml`, `.yml`, `.toml`) for placeholders — `.json` files are parsed and walked recursively.
   - error shapes: `Unresolved TODO/placeholder`, `Unresolved placeholder: <resource>`, `Resource escapes outside plugin: <resource>`, `Resource symlink escapes outside plugin: <resource>`, `Resource unavailable: <resource>: <reason>`, `Manifest symlink escapes outside plugin`.
2. **Schema validation** — spawns `zcode plugins validate <absolute plugin path>` with inherited stdio. `--cli` overrides the executable; when it ends in `.js`, `.cjs` or `.mjs` it is run as `node <entry>`, because a `.js` file is not executable on its own. On Windows a `.cmd` shim is refused — `spawn` without a shell cannot resolve `PATHEXT`, and with a shell Node's security policy blocks it — so pass `zcode.exe` or the CLI's JavaScript entry. A non-zero child exit becomes `ZCode plugin validation failed (<code>)`; a spawn failure surfaces verbatim, e.g. `spawn <cli> ENOENT`.

Notes:

- There is no `--help` flag; passing one fails as an unknown option. Zero or multiple positionals print the usage line and exit `1`.
- The default `--cli zcode` resolves against `PATH`. On a machine where `zcode` is a GUI bundle rather than the CLI, that call will not behave like a validation run — pass the CLI's JavaScript entry explicitly.
- File checks alone do not prove schema validity or that the plugin loads. Report which checks actually ran.

## 7. `upsert-dev-marketplace.mjs`

```bash
node scripts/upsert-dev-marketplace.mjs <plugin-path> [--marketplace-path file] [--display-name name] [--name-zh name] [--description-zh text]
```

Registers or refreshes one plugin in a local dev marketplace. It writes the catalog file and nothing else — no user config, no install cache, no market registration.

Preconditions, all enforced before any write:

- `preflightPlugin` passes (the same checks as §6).
- `normalizePluginName(manifest.name) === manifest.name === basename(plugin root)`, else `Plugin directory and manifest name must match`.
- `manifest.version` is a non-empty string, else `A plugin version is required for dev updates`.
- The marketplace root exists, else `Marketplace root is missing or outside the plugin parent`.
- `marketplacePlan(..., force=true, requireSameSource=true)`: a same-name entry pointing elsewhere is `Marketplace source conflict: <name>`, never a silent replacement.

Marketplace selection:

- Default target: `<plugin parent>/marketplace.json`.
- The generated market name is `dev-<label>-<hash8>`. The label is the root directory name (or its parent when the root itself is named `plugins`), lowercased, non-alphanumerics collapsed to hyphens, capped at 48 characters, falling back to `workspace`. The hash is the first 8 hex characters of SHA-256 over the canonical root path (lowercased first on Windows, where paths are case-insensitive). Same workspace yields the same name on every run; different workspaces do not collide.
- Without `--marketplace-path`, an existing catalog whose name is not this dev name is refused: `Existing marketplace is not this development market; pass --marketplace-path explicitly to reuse it`. With the flag, any catalog is adopted and keeps its name.
- The entry receives `version` and `description` from the manifest on every run; `displayName` falls back from `--display-name` to the existing value to the plugin name; `--name-zh` and `--description-zh` merge into `displayName_i18n` and `description_i18n` under `zh-CN`. Unrelated entries, their order and the market name are untouched.
- The write is skipped when the computed catalog equals the on-disk content (`changed: false`) — rewriting would bump mtime and make the host re-read an unchanged file.

It prints one JSON object and exits `0`:

```json
{
  "marketplaceId": "dev-myworkspace-1a2b3c4d",
  "marketplaceRoot": "/abs/path/to/plugins",
  "marketplacePath": "/abs/path/to/plugins/marketplace.json",
  "pluginId": "my-plugin@dev-myworkspace-1a2b3c4d",
  "pluginPath": "/abs/path/to/plugins/my-plugin",
  "version": "0.1.0",
  "changed": true
}
```

Read `marketplaceId`, `pluginId` and `marketplaceRoot` from this output for the handoff; never derive them by hand.

## 8. Workflow — new plugin

1. Pin down the capability: one representative input and one observable expected result. That example doubles as the smoke test and the trial prompt.
2. Choose the source location, default `<workspace>/plugins/<slug>/`. An explicit user directory wins. For remote work, write on the target host.
3. Read `references/plugin-json-spec.md` before picking components — it lists every manifest field and how the loader reads it.
4. Scaffold. With Node, run `create-basic-plugin.mjs` with only the `--with-*` flags the plugin needs; without Node, create the same files by hand from the reference examples. Either way the directory name must equal the manifest name.
5. Implement the capability. Replace the scaffold descriptions with the real purpose, flesh out `tools/list` in the MCP skeleton, and keep secrets in user config, environment or credential mechanisms — never in the manifest.
6. Verify what the environment can actually verify: `validate-plugin.mjs <path>`, plus `--cli` with a known-working ZCode entry when one exists. Report any check that could not run instead of implying it passed.
7. Catalog: run `upsert-dev-marketplace.mjs <path>`, or write the catalog by hand following the reference layout. Files on disk are not a registered market and not an installed plugin.
8. Hand off with the real paths, market name, plugin ID and version from the script output, the UI steps from `references/installing-and-updating.md`, and the trial prompt with its expected result.

## 9. Workflow — change an existing plugin

1. Edit the original source in place. Keep the manifest name — it is the plugin's stable identity — and bump `version`.
2. Re-run the checks from step 6 above.
3. Re-run `upsert-dev-marketplace.mjs`. It is idempotent and refreshes `version` and `description` in the same entry.
4. Ask the user to refresh the market and update the installed plugin per the reference. Source edits are not hot reload: refreshing the catalog does not update the installed copy.
5. Do not re-scaffold over implemented source with `--force`, and never hand-edit installed caches.

## 10. Pitfalls

- **The usage line under-reports the flags.** `create-basic-plugin.mjs` prints only `--with-skills`, `--with-mcp` and `--with-hooks`, but `--with-commands`, `--with-scripts` and `--with-assets` are accepted as well (verified against the running script).
- **`create-basic-plugin.mjs --force` can steal a marketplace entry.** Its plan call does not pass `requireSameSource`, so with `--force` an existing same-name entry that points at a different directory is overwritten. Use `upsert-dev-marketplace.mjs` for updates.
- **The scaffolded catalog entry carries only `name` and `source`.** `version`, `description` and the display/i18n fields come from `upsert-dev-marketplace.mjs`; a catalog written by `create-basic-plugin.mjs --marketplace-path` alone shows no version in the UI.
- **A foreign catalog is not yours to rename.** Without `--marketplace-path`, upsert refuses any catalog not named after this dev market. Pass the flag to adopt an existing catalog deliberately.
- **Name discipline is load-bearing.** Directory name, manifest name and marketplace entry name must agree; the validator rejects an entry whose manifest name differs (`Plugin manifest name '…' does not match marketplace entry '…'`).
- **Placeholders fail the preflight.** A `TODO`, `FIXME`, `<your …>` or `YOUR_API_KEY` in any scanned text file stops the run before the schema stage.
- **`--force` is for scaffolds, not iterations.** It overwrites files; ordinary iteration edits them and bumps the version.
- **A stale `.lock` file blocks the catalog.** Delete the `<marketplace>.lock` named in the error after a crashed run.
- **The MCP skeleton has no tools.** `tools/list` returns `[]` until real tools exist; a caller cannot distinguish "working but empty" from "broken" once you fake the list.
- **The SessionStart skeleton is silent by design.** Its stdout would be injected into every session's context.

## 11. Without Node

Everything above degrades to file tools: write `plugin.json` and the component files from `references/plugin-json-spec.md`, then write the catalog in the documented layout, choosing a distinct `dev-`-prefixed market name and reusing it on later edits. Never ask the user to install Node just to finish the UI handoff.

## References

- `references/plugin-json-spec.md` — every `plugin.json` and marketplace field, with the code that reads it.
- `references/installing-and-updating.md` — the manual add, install, update and trial steps in the app.
