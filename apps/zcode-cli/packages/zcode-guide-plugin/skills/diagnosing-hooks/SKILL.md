---
name: diagnosing-hooks
description: Use to diagnose and fix ZCode hook configuration problems in the ZCode client. Applies when a hook does not trigger, an event name is wrong, a matcher does not match a tool name, a script is not executable, template variables are not expanded, a timeout unit is mistaken (seconds versus milliseconds), the command and process field styles are mixed, a hook's JSON output fails validation, a hook blocks the session unexpectedly, or configuration-file hooks are not enabled. Provides configuration sources, the hooks.json schema, how to inspect hooks in the client, and a step-by-step localization and repair workflow.
---

# Diagnosing Hook Configuration

The goal is one concrete fix per problem.

> On trust: plugin hooks execute regardless of which marketplace they came from — third-party plugin hooks run exactly like built-in ones. Any "diagnostic-only until trusted" wording still visible for marketplace hooks is stale; a plugin's detail view marks each hook as runnable, and that now holds for all of them.

## 1. Where hooks come from, and how they merge

- **Configuration-file hooks** live under the top-level `hooks` key of `~/.zcode/cli/config.json`, or of the workspace `<repo>/.zcode/config.json` / `zcode.json`. The shape is `{ enabled?, timeoutMs?, maxOutputBytes?, events: { <Event>: [ { matcher?, hooks: [...] } ] } }`. **They are off by default — configuration-file hooks need `hooks.enabled: true` to run at all.**
- **Plugin hooks** come from each plugin's `hooks/hooks.json`, or its manifest `hooks` field. Plugin matchers are appended after configuration matchers. **The moment any plugin contributes a hook, the runner enables itself automatically.**
- Non-plugin configuration hooks carry no trust gate; with `enabled: true` they run unconditionally.

## 2. The hooks.json schema

```json
{ "hooks": { "<Event>": [ { "matcher": "...", "hooks": [ { "type": "command"|"process", ... } ] } ] } }
```

A plugin file uses that outer `hooks` wrapper; a configuration file uses `hooks.events.<Event>`. The inner array is identical in both.

- **Exactly seven event names**: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop`. Anything else is unsupported — `Notification`, `SubagentStop` and `PreCompact` among them are **not**.
- **The matcher is a case-sensitive regular expression**, tested against the event's match value:
  - `SessionStart` → one of `startup`, `resume`, `clear`, `compact`
  - Tool events (`PreToolUse`, `PostToolUse`, `PermissionRequest`, `PostToolUseFailure`) → the **tool name** (`Bash`, `Read`, `Write`, `Edit`, `Agent`, …), with aliases `Task` ↔ `Agent` and `Write`/`Edit` ← `ApplyPatch`
  - `UserPromptSubmit` → the prompt text; `Stop` → the response preview
  - An omitted matcher matches everything; an invalid expression matches nothing, silently
- **`type: "command"`** takes `command` (a shell string), plus optional `shell`, `timeout` in **seconds**, `timeoutMs` in milliseconds which wins when both are present, and `statusMessage`. `async` currently has no runtime effect.
- **`type: "process"`** takes `command` (an executable) plus `args[]` — an argument vector run without a shell, and the most portable option — along with `timeoutMs` in **milliseconds** and `statusMessage`.
- Timeout resolution runs `timeoutMs` → `timeout × 1000` → the configuration's `timeoutMs` → a 60000 ms default.
- Template variables expand in the command and in each argument, and are injected as environment variables too: `${CLAUDE_PROJECT_DIR}` / `${ZCODE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, and for plugin hooks only `${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}` plus the plugin data directory. A skill-directory variable is not valid inside a hook and raises an error.
- **Hook output**: stdout is parsed as JSON against a strict schema where any extra key fails validation. Alternatively use exit codes — `0` passes, `2` blocks (a deny for `PreToolUse`/`PermissionRequest`), any other non-zero raises. `additionalContext` is injected into the conversation; `PreToolUse` may return a permission decision of `allow`/`ask`/`deny`; `Stop` may ask for continuation, up to three times.

## 3. Inspecting hooks

- **Client**: **Settings → Plugin Management**, then a plugin's detail view, shows the hooks it registers and whether each is runnable.
- **Agent**: read a plugin's `hooks/hooks.json` or its manifest `hooks` field, and the `hooks` block of `~/.zcode/cli/config.json` or the workspace config for configuration hooks.
- **Execution** — fired, timed out, blocked — is recorded in the ZCode log with the hook's source, matcher, outcome, duration and a preview of its error stream, which is enough to tell a timeout from a failure from a block.

## 4. Pitfalls, by symptom

1. **Configuration-file hooks never run.** You added `hooks.events.*` and nothing fires, because they are off by default and only switch on automatically when a plugin hook exists. → Set `"hooks": { "enabled": true, ... }`.
2. **Wrong event name.** The hook never triggers. → Use one of the seven, exactly.
3. **Matcher never matches.** Registered but silent for the tool you expect. The matcher is a case-sensitive regular expression, so `"bash"` will not match `Bash`, and an invalid expression matches nothing. → Use the exact tool name or a correct expression such as `"Edit|Write"`, or drop the matcher to match all. Keep the aliases in mind: `Task` → `Agent`, `Write`/`Edit` → `ApplyPatch`.
4. **Script not executable.** `permission denied` and a failed outcome, because the file was installed without its executable bit. → `chmod +x` it, or invoke it through an interpreter — `{"type":"command","command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/x.sh\""}` — which makes the bit irrelevant.
5. **Template variable not expanded.** A literal `${...}` or an empty path. Only recognized variables expand; a skill-directory variable raises an error inside a hook, and `${CLAUDE_PLUGIN_ROOT}` exists only for plugin hooks. → Use supported variables only, and `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths.
6. **Timeout unit mistaken.** The hook is killed with a timed-out outcome. A `command` hook's `timeout` is **seconds**; a `process` hook's `timeoutMs` is **milliseconds**. `timeout: 500` is 500 seconds; `timeoutMs: 5` is 5 milliseconds. → Use `"timeout": <seconds>` for command hooks and `"timeoutMs": <milliseconds>` for process hooks.
7. **Command and process fields mixed.** The hook is dropped. A `process` hook accepts only `command`, `args` and `timeoutMs`; a `command` hook accepts `command`, `shell`, `timeout` and `timeoutMs`. → Match the fields to the `type`.
8. **JSON output fails validation.** The hook ran, its effect was discarded and the run was marked failed. The output was not valid JSON, carried an extra key against a strict schema, or named the wrong event in event-specific output. → Emit only recognized keys with the right event name, or emit nothing — empty output is fine — and lean on exit codes.
9. **`async` assumed to background.** You set `async: true` and the session still waits, because the field has no runtime effect and hooks always run inline. → Do not rely on it; have the script daemonize itself if it needs to background.
10. **Cross-platform failure.** Works on one OS, not another. A `command` hook goes through a shell, so POSIX syntax breaks on Windows. → Prefer a `process` hook, an argument vector with no shell, or ship a polyglot wrapper and keep hook scripts extensionless.
11. **Hook blocks the session unexpectedly.** A tool is denied or the run halts because the hook returned a block, exited `2`, or returned a `deny` decision. → Read the block's reason in the log and fix the exit code — `0` to pass, `2` reserved for a deliberate block.
12. **Third-party hooks assumed diagnostic-only.** A third-party plugin hook did not run and a trust gate was blamed. That is not the cause; every plugin hook is runnable. → Diagnose through pitfalls 2, 3, 4 and 8.

## 5. Narrowing it down

1. **Is a runner active?** Either `hooks.enabled: true` in the configuration, or at least one plugin contributing a hook. Without either, no runner exists and every hook is skipped.
2. **Enumerate what is registered.** In **Settings → Plugin Management** open the plugin's detail view, confirm the expected hook is present and runnable, and confirm its plugin is enabled. For configuration hooks, read the `hooks` block directly.
3. **Event name and matcher.** Check against the seven events, confirm the match value and the case-sensitive expression, and test by dropping the matcher, which matches everything.
4. **Executable and interpreter.** Confirm the executable bit, or invoke the script explicitly through `bash` or `node`.
5. **Run it by hand.** Feed a sample hook input to the script and inspect the exit code and output — `0` plus valid JSON is healthy, `2` is a deliberate block, anything else non-zero is a failure.
6. **Watch it live.** Trigger the event and read the hook run records in the log — outcome, duration, error-stream preview — to separate a timeout from a failure from a block.
