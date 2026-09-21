---
name: diagnosing-mcp
description: Use to diagnose and fix ZCode MCP (Model Context Protocol) server configuration problems in the ZCode client. Applies when an MCP server will not connect, its tools (mcp__server__tool) do not appear, it shows as disabled or failed, connections time out, a command cannot be found, template variables are not expanded, or a server defined in a configuration file has no effect. Provides configuration locations, how to inspect status in Settings, common pitfalls, and a step-by-step localization and repair workflow.
---

# Diagnosing MCP Configuration

The goal is a single file-and-field edit. A person reads status in the client; an agent edits the configuration files directly.

> Three things are routinely misremembered: the user configuration file is `~/.zcode/cli/config.json`; `.agents/mcp.json` is a **compatibility fallback**, read only when the same scope's `.zcode` declares no MCP servers; and in the desktop client MCP status and repair live under **Settings → MCP**.

## 1. Where servers are declared, and who wins

| Scope | File | Field |
|---|---|---|
| User | `~/.zcode/cli/config.json` | `mcp.servers` |
| User fallback | `~/.agents/mcp.json` | `mcpServers` — consulted only when the user `.zcode` file declares no servers |
| Workspace | `<repo>/.zcode/config.json` or `<repo>/zcode.json`, read for every directory from the repository root down to the working directory | `mcp.servers` |
| Workspace fallback | `<repo>/.agents/mcp.json` | `mcpServers` — consulted only when the workspace `.zcode` file declares no servers |
| Plugin | `<pluginRoot>/.mcp.json`, or the manifest's `mcpServers` field | Keys are namespaced `plugin:<plugin>:<server>` |

Inside a scope `.zcode` wins and `.agents/mcp.json` is the same-scope fallback: the moment that scope's `.zcode` declares any server, its `.agents/mcp.json` is ignored completely. The two also use different shapes — `.zcode` nests under `mcp.servers`, `.agents/mcp.json` uses a top-level `mcpServers`.

Across scopes the override chain for a same-named server is **CLI → environment → user → workspace → system**, which reduces to: user beats workspace. Plugin servers sit at the bottom and lose to any explicit configuration.

**Auto-connect**: servers from every scope — user, **workspace**, plugin, environment and CLI — are trusted and connected at session start. Workspace servers used to be untrusted and reported `Project MCP server requires explicit connection before use.`; that gate is gone and they now behave like any other scope. **Settings → MCP** is the supported surface for status and repair.

## 2. The schema

- `stdio` needs `command`; `args[]`, `cwd`, `env`, `enabled` and `timeoutMs` are optional.
- `http` and `sse` need `url`; `headers`, `enabled` and `timeoutMs` are optional.
- Use `env` for stdio environment variables and `headers` for HTTP/SSE request headers. `command` is a string and `args` an array of strings — do not paste OpenCode-style `command: ["npx", "-y", "..."]` into ZCode's JSON editor.
- With `type` omitted it is inferred: `command` implies stdio, `url` implies http. Legacy shapes are migrated when the CLI reads config directly (`type: "remote"` → `http`, `environment` → `env`, `enable` → `enabled`, `http_headers` → `headers`). Desktop app-managed session creation may bypass part of that parser, so prefer the canonical fields (`env`, `headers`, `enabled`, `type: "http"`) in files the desktop **Settings → MCP** page reads.
- The configuration-file schema is **strict**: one unknown key and the server is dropped.
- **`${...}` templates expand only for plugin-provided servers** — `${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}`. Configuration-file servers expand nothing; use absolute paths there.
- Default timeout is 30000 ms.

```json
{
  "mcp": {
    "servers": {
      "mysql-local": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@benborla29/mcp-server-mysql"],
        "env": { "MYSQL_HOST": "127.0.0.1", "MYSQL_PORT": "3306" }
      },
      "remote-reader": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ..." }
      }
    }
  }
}
```

## 3. Reading status

- **Settings → MCP** lists every server as connected, disabled, disconnected or failed, with the error inline. Plugin-provided ones are marked built-in. (`untrusted` is a legacy status that no longer shows up for normally configured servers, since every scope auto-connects now.)
- **After an edit**, restart the session — or restart ZCode if the page still shows stale data — then reopen **Settings → MCP**.
- **Stdio error output** causes most failures. A stdio server's captured error stream goes to the ZCode log; for the full picture, run its `command` with its arguments in a terminal yourself.

## 4. Pitfalls, by symptom

1. **Workspace server will not connect.** Workspace servers auto-connect like any other scope, so this is no longer a trust gate — it is a real config or startup problem. → Read its **Settings → MCP** status: `failed` goes to pitfall 5; absent means the config never loaded (pitfalls 5/9) or it sits in `.agents/mcp.json` and got shadowed (pitfall 12).
2. **`command not found`.** Status `failed` with something like `spawn npx ENOENT`. The command is not on `PATH`, or a relative path was never resolved. → Use an absolute path, add `cwd` if needed, and on Windows target the `.cmd` or `.exe`.
3. **`${...}` arrives literally.** Configuration-file servers do not expand templates. → Substitute concrete absolute paths; templates are plugin-only.
4. **A plugin is missing an environment value.** → Set the plugin's configuration value (Plugin Management → the plugin's advanced settings) or export the variable. Sensitive values belong in `env`/`headers` only, never in `command` or `url`.
5. **Wrong transport type or unknown key.** The server is silently dropped. → Make `type` agree with the fields, remove extra top-level keys (the schema is strict), and have exactly one of `command` (stdio) or `url` (http/sse).
6. **Your workspace edit has no effect.** A same-named server in the user configuration shadows it, because user beats workspace for MCP. → Edit the user entry, or rename one of the two.
7. **Connection or tool-listing timeout.** `failed ... timed out after 30000ms`. → Add `"timeoutMs": 60000` to that server and fix the slow startup.
8. **Only `Connection closed`, no cause.** The error stream never reached the status line. → Check the ZCode log for the captured output, or run the `command` by hand.
9. **JSON syntax error.** Servers — possibly the whole file — disappear. → Validate and fix the JSON.
10. **Server shows disabled.** `enabled: false`, or legacy `enable: false`. → Set `"enabled": true` or remove the field.
11. **File edits do nothing.** The client is supplying the MCP list itself. → Manage MCP through **Settings → MCP** in that context.
12. **`.agents/mcp.json` edits do nothing, or use the wrong key.** Either the same scope's `.zcode` already declares servers, so the fallback is ignored for that scope; or the entries were put under `mcp.servers` instead of the top-level `mcpServers` that file expects. → Move the definition into that scope's `.zcode` file, or make sure that scope's `.zcode` declares none and use the top-level `mcpServers` key.
13. **The name is in the logs but no `mcp__...` tools reach the model.** The desktop app read the entry and passed the name on, then the server died during startup, leaving `toolCount` and `registeredToolCount` at zero. A frequent cause is a legacy `environment` field in `~/.zcode/cli/config.json`: CLI direct parsing migrates it, but the desktop app-managed path expects `env` when converting to protocol `mcpServers`. → Rename `environment` to `env`, keep the values, restart ZCode, reopen **Settings → MCP**.
14. **Settings → MCP crashes after JSON editing with `command.trim is not a function`.** The saved server has a non-string `command`, usually OpenCode-style `command: ["npx", "-y", "server"]`. → Edit `~/.zcode/cli/config.json` by hand: `"command": "npx"` with the rest moved into `"args": ["-y", "server"]`, then restart the app.

## 5. Narrowing it down

1. Confirm MCP is enabled — it is, by default.
2. Open **Settings → MCP** and read the status. `disabled` → pitfall 10. `failed (<error>)` → read the inline error and jump to step 4. **Not listed at all** → step 3. (`untrusted` should no longer appear for a normally configured server.)
3. Confirm the configuration is loaded and valid: check the JSON of `~/.zcode/cli/config.json`, `<repo>/.zcode/config.json` and `zcode.json` — pitfall 9. In the file but not listed means schema validation rejected it (pitfall 5 — look for unknown keys, a wrong `type`, or a missing `command`/`url`). Defined only in `.agents/mcp.json` and missing points at fallback shadowing or the wrong key (pitfall 12).
4. Diagnose a `failed` server: `ENOENT` → pitfall 2; `timed out` → pitfall 7; `Connection closed` → pitfall 8; an http/sse network error → check proxy, CA, URL reachability and `headers`.
5. If **Settings → MCP** or the service logs show `mcpServerCount` or server names while the model request carries no `mcp__...` tools, look for `mcp.startup.completed` and `mcp.tools.registered` in the startup logs. With `toolCount=0` alongside failed statuses, check the config field names first — `env` versus `environment`, string `command` versus array `command` — before treating it as a model-selection problem.
6. Edits with no effect → pitfall 6 (user beats workspace) or pitfall 11 (desktop-managed list).
7. A literal `${...}` → pitfall 3 (files do not expand templates) or pitfall 4 (an unset plugin variable).
8. Apply the fix — most often editing `mcp.servers.<name>` in `~/.zcode/cli/config.json` (`command` / `args` / `cwd` / `env` / `headers` / `timeoutMs` / `enabled`) — then restart the session, since every scope auto-connects, and reopen **Settings → MCP** to confirm.
