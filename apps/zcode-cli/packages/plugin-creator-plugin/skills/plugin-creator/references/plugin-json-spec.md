# `plugin.json` and marketplace catalog reference

Every field below is read by code in this repository: the plugin loader (`packages/adapters/src/plugins/index.ts`, `marketplace.ts`, `mcp.ts`, `hook-sources.ts`, `helpers.ts`) or the bundled scripts (`scripts/validate-plugin.mjs`, `scripts/scaffold-files.mjs`, `scripts/upsert-dev-marketplace.mjs`). Nothing here is aspirational.

## Where the manifest lives

- Canonical location: `<plugin root>/.zcode-plugin/plugin.json`. This is what the scaffold writes and what the preflight reads.
- The loader also falls back to `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` when `.zcode-plugin/plugin.json` is absent. New plugins should use `.zcode-plugin`.
- The file must be a JSON object. Invalid JSON, or a missing/invalid `name`, is a hard error (`plugin_manifest_invalid`), not a warning.

## Manifest fields

### `name` — required

- Loader rule: must match `^[a-z0-9][a-z0-9._-]{0,127}$` (start with a lowercase letter or digit; then lowercase letters, digits, dot, underscore, hyphen; at most 128 characters).
- Scaffold rule, stricter: `normalizePluginName` keeps lowercase letters, digits and hyphens only, 1–64 characters, because the name doubles as the directory name and the marketplace entry ID.
- Must equal the plugin directory name (enforced by `upsert-dev-marketplace.mjs`: `Plugin directory and manifest name must match`) and the marketplace entry name (enforced by validation: `Plugin manifest name '…' does not match marketplace entry '…'`).

### `version` — string

- Missing → the loader treats the plugin as `0.0.0`. The scaffold writes `0.1.0`.
- `upsert-dev-marketplace.mjs` requires a non-empty string (`A plugin version is required for dev updates`) and copies it into the catalog entry.
- Bump it for every source change; the installed copy updates against this value.

### `description` — optional string

- Scaffold writes `<name> plugin`; replace it with the real purpose. Copied into the catalog entry by the upsert helper.

### `author` — string or object

- Accepts `"Name"` or `{ "name": "…", "url": "…" }`. The scaffold writes `{ "name": "Local developer" }`.

### `license`, `homepage`, `repository`, `keywords` — optional

- Pass-through metadata shown in details UI. The scaffold writes none of them.

### `skills` — string or array of strings

- Each entry is a path relative to the plugin root. Absolute paths and paths that escape the root are rejected (`plugin_component_path_invalid`).
- A `skills/` directory that exists is picked up even without the field; declaring it explicitly (`"./skills"`) is what the scaffold does.
- Each skill is `<directory>/SKILL.md` with `name` and `description` YAML frontmatter.

### `commands` — string, array, or object

- String or array: paths to markdown command roots, same containment rules as `skills`.
- Object form: maps a command name to its metadata. Each value must provide exactly one of `source` (a markdown file path inside the root) or `content` (inline markdown); remaining keys become the command's frontmatter. The loader materializes these into the plugin data directory.

### `hooks` — string, array, or inline object

- String or array: paths to hooks files. `hooks/hooks.json` is loaded automatically when it exists, even if the field is absent.
- A hooks file is wrapped — the top level must be a `hooks` object:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\""
          }
        ]
      }
    ]
  }
}
```

- Event names must be supported by the runtime; unsupported ones produce a `plugin_hook_unsupported_event` warning and are skipped.
- Write `${CLAUDE_PLUGIN_ROOT}` (or `${ZCODE_PLUGIN_ROOT}`) in hook commands; the runner substitutes the installed plugin root. A SessionStart hook's stdout is injected into every session's context — keep the default scaffold silent until a real behavior exists.

### `mcpServers` — string, array, or inline object

- String: a path to an `.mcp.json`-style file. Array: several such specs merged. Object: inline server definitions. A root-level `.mcp.json` is also read automatically.
- Shape, either wrapped or bare:

```json
{
  "mcpServers": {
    "my-server": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs"] }
  }
}
```

- Server types: `stdio`, `http`, `sse`. Runtime server names are namespaced as `plugin:<plugin name>:<server name>`.
- `${CLAUDE_PLUGIN_ROOT}` and `${ZCODE_PLUGIN_ROOT}` are substituted in arguments and environment values. Other `${VAR}` references resolve against the variable context (process environment, `userConfig` defaults, plugin options); an unresolvable required one is `plugin_variable_missing`.
- The scaffold's MCP server implements only the handshake: `initialize` echoes the client's `protocolVersion`, `tools/list` returns `[]`, `ping` returns `{}`, other methods return `-32601`. Implement real tools before claiming a working integration.

### `userConfig` — object of option definitions

- Each value: `{ "type": "string" | "number" | "boolean" | "directory" | "file", "default"?, "required"?, "sensitive"?, "title"?, "description"? }`.
- `sensitive` values are never logged. A `required` option without a default raises `plugin_variable_missing` until the user configures it.
- Keep secrets here or in the environment — never in the manifest body.

### `dependencies` — optional

- Plugin references as `name`, `name@marketplace`, or `{ "name", "marketplace" }` objects. Validated for existence, cycles and cross-marketplace rules.

### Diagnostic-only fields

- `channels`, `lspServers`, `outputStyles` and `settings` are recognized but not executed by this runtime; each produces a `plugin_unsupported_component` warning. Do not build a plugin that depends on them.

## Preflight rules enforced by `scripts/validate-plugin.mjs`

Beyond the manifest schema, the preflight rejects:

- unresolved placeholders — `TODO`, `FIXME`, `<your …>`, `YOUR_API_KEY` — anywhere in the manifest or in scanned resource text files;
- declared resources (fields `skills`, `commands`, `hooks`, `mcpServers`, plus `${CLAUDE_PLUGIN_ROOT}/…` references inside manifest strings) that do not exist, escape the plugin root, or escape through a symlink;
- text files scanned for placeholders: `.json`, `.md`, `.mjs`, `.cjs`, `.js`, `.ts`, `.txt`, `.yaml`, `.yml`, `.toml`; `.json` files are parsed and walked recursively. When expanding directories, `node_modules` and `.git` are skipped.

`zcode plugins validate <path>` then performs the real schema and component validation (manifest fields, component paths, MCP config, hook config, dependency closure). Neither stage executes the plugin — runtime proof is the trial prompt.

## Marketplace catalog

```json
{
  "name": "dev-myworkspace-1a2b3c4d",
  "plugins": [
    {
      "name": "my-plugin",
      "source": "./my-plugin",
      "version": "0.1.0",
      "description": "The implemented workflow",
      "displayName": "My Plugin",
      "displayName_i18n": { "zh-CN": "我的插件" },
      "description_i18n": { "zh-CN": "已实现的工作流说明" },
      "category": "productivity"
    }
  ]
}
```

- `name` must match `^[a-z0-9][a-z0-9._-]{0,127}$`; `plugins` must be an array whose entries have unique string names. Both are enforced by `marketplacePlan` in `scripts/marketplace-files.mjs`, which refuses to guess at or rebuild a malformed existing catalog.
- Entry `source` is resolved against the market root — for `.claude-plugin/marketplace.json` that is the parent of `.claude-plugin`, for a root-level `marketplace.json` the directory holding it. Local development uses relative directory sources (`./my-plugin`). Other source types exist in the loader (`url`, `github`, `git`, `npm`, `file`, `directory`) but are outside this workflow.
- Optional entry metadata the store UI reads: `displayName`, `displayName_i18n`, `description_i18n`, `icon` (an HTTPS URL), `category`, `author`, `homepage`, `privacyPolicy`, `termsOfService`, `heroImage`, `examplePrompts`, `examplePrompts_i18n`, `requiresPaidPlan`. Omit what you do not have; never fabricate an icon URL.
- `scripts/upsert-dev-marketplace.mjs` maintains only `name`, `source`, `version`, `description`, `displayName`, `displayName_i18n` and `description_i18n`; everything else in the file is preserved verbatim, including entries added by hand.
- `scripts/create-basic-plugin.mjs --marketplace-path` writes a thinner entry — only `name` and `source` — because it runs before the manifest is customized. Run the upsert helper afterwards to fill in `version`, `description` and the display fields.
