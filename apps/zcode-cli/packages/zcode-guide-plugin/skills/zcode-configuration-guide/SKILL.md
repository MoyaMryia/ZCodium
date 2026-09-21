---
name: zcode-configuration-guide
description: Use when configuring ZCode's extension resources (MCP servers, slash commands, skills, hooks, and plugins) or instruction files such as AGENTS.md in the ZCode client. Explains where each resource is configured at the user and workspace scope, the discovery order, precedence, and merge rules, plus guidance on which location to choose. Use when someone asks how to add an MCP server, command, skill, hook, plugin, or AGENTS.md instructions, where a configuration file lives, why a configuration is not taking effect, or needs routing to a specific diagnostic skill.
---

# ZCode Configuration Guide

ZCode has five kinds of extension resources, plus AGENTS.md instruction files. This skill is the **map**: for each resource it says where it is configured and how conflicts resolve. When something is broken rather than merely unknown, skip to the routing list at the end and load the matching `diagnosing-*` skill.

## Two ways configuration happens

Both audiences are served here:

- **A person** works through the client UI — **Settings → Plugin Management**, **Settings → Skills**, **Settings → Subagents**, **Settings → MCP**, and the **`/` menu** in the input box.
- **An agent** fixes things by reading and editing the underlying files with its own file tools. Everything below is written so an agent can find the right file and the right field.

## Scopes, and the files that carry them

Two scopes exist. **User scope** sits under the home directory and applies everywhere. **Workspace scope** sits inside a repository, applies only there, and can be committed so a team shares it.

| What | User scope | Workspace scope |
|---|---|---|
| Configuration file | `~/.zcode/cli/config.json` | `<repo>/.zcode/config.json` (or `<repo>/zcode.json`) |
| Instruction file | `~/.zcode/AGENTS.md` | `<repo>/AGENTS.md` |

The user configuration file holds MCP servers, hooks, plugin enable/disable state, and skill/command disable overrides. The workspace path is searched upward from the current directory until the project root is found.

## The five resources, side by side

| Resource | Shape | User scope | Workspace scope | When two collide |
|---|---|---|---|---|
| **Skills** | Directory + `SKILL.md` | `~/.zcode/skills/`, `~/.agents/skills/` | `<repo>/.zcode/skills/`, `<repo>/.agents/skills/` | Identity is the file path; the **first same-named skill in discovery order wins**, and user scope precedes workspace |
| **Commands** | A `.md` file | `~/.zcode/commands/`, `~/.agents/commands/` | `<repo>/.zcode/commands/`, `<repo>/.agents/commands/` | Deduplicated by normalized name; **first match wins**, the other is ignored |
| **MCP** | A JSON object | `~/.zcode/cli/config.json` → `mcp.servers` (fallback `~/.agents/mcp.json` → `mcpServers`) | `<repo>/.zcode/config.json` → `mcp.servers` (fallback `<repo>/.agents/mcp.json` → `mcpServers`) | **User beats workspace** for a same-named server; workspace servers are **trusted and auto-connected** just like user ones |
| **Hooks** | `hooks.json` or a config object | `~/.zcode/cli/config.json` → `hooks` | `<repo>/.zcode/config.json` → `hooks` | Config-file hooks need `hooks.enabled: true`; plugin hooks are appended after them |
| **Plugins** | Directory + `plugin.json` | Installed from a marketplace; state lives in `~/.zcode/cli/config.json` | — | One plugin contributes skills, commands, hooks, MCP servers and agents |
| **Instructions** | An `AGENTS.md` file | `~/.zcode/AGENTS.md` | `<repo>/AGENTS.md` | User defaults load first, workspace loads after, so workspace can narrow or override |

> `.agents/mcp.json` is a **compatibility fallback**. Within one scope the client reads `.zcode` first and only falls back to `.agents/mcp.json` when that scope defines no MCP servers at all. Note the key shapes differ: `.zcode` nests under `mcp.servers`, while `.agents/mcp.json` uses a top-level `mcpServers`.

## AGENTS.md, and how the two files combine

`AGENTS.md` is none of the five resources. It is the instruction file ZCode loads into model context for broad behavioural rules.

- `~/.zcode/AGENTS.md` — personal defaults for every workspace: preferred language, review style, local conventions.
- `<repo>/AGENTS.md` — rules specific to this repository and meant to be shared: architecture boundaries, logging rules, testing requirements, commit and MR policy.
- **Resolution** — the workspace file is searched from the current working directory upward to the detected project root; the user file comes from the home directory.
- **Merge order** — when both exist, the user file is injected first and the workspace file second. Later text wins for anything that contradicts it, which is what lets a repository narrow a broad default.
- **Creating and migrating** — onboarding can copy `~/.claude/CLAUDE.md` into `~/.zcode/AGENTS.md`. The built-in `/init` targets the workspace file, so it creates or updates repository instructions rather than touching the user default.

## Discovery order for skills and commands

Both resource types scan the same locations, earliest first:

1. Explicitly configured roots
2. User `~/.zcode/skills` (or `commands`)
3. User `~/.agents/skills`
4. Workspace `.zcode/skills` — every directory from the working directory up to the repository root counts
5. Workspace `.agents/skills`
6. Enabled **plugin** roots, lowest of all

Within a level `.zcode` is read before `.agents`, and a deeper working-directory location beats one at the repository root.

- **Skills** are keyed by file path, so same-named skills at different paths are all discovered but only the first is loaded — the rest are shadowed.
- **Commands** are keyed by normalized name and the first match wins; the rest are dropped. Nested directories join with a colon, so `review/code.md` is `/review:code` rather than `/review/code`.

## MCP: override order and auto-connect

For a same-named server the override chain is **CLI → environment → user → workspace → system defaults** — in short, user beats workspace. Plugin-provided servers are the base layer and lose to any explicit configuration.

Every scope — user, **workspace**, plugin, environment and CLI — is **trusted and connected automatically** when a session starts. Workspace servers used to be untrusted and needed manual authorization; that gate is gone. Inspect and repair them in **Settings → MCP**.

## Hooks, the short version

Exactly seven events are supported: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop`.

Configuration-file hooks are off until `hooks.enabled: true` is set. The moment any plugin contributes a hook, the runner switches itself on.

## Plugins, the short version

Managed in **Settings → Plugin Management**, which has **Installed** and **Discover** tabs. The manifest lives at `.zcode-plugin/plugin.json`; `.claude-plugin/` and `.codex-plugin/` are accepted as compatibility names. Only `name` is required, and it must match `^[a-z0-9][a-z0-9._-]{0,127}$`.

Component fields are `commands`, `skills`, `hooks`, `mcpServers` and `agents`, each accepting a directory name, an array, or an inline value. `channels`, `lspServers`, `outputStyles` and `settings` are recorded but never executed.

Enable/disable state lives under `plugins` in `~/.zcode/cli/config.json`. A built-in plugin can be switched off but not removed. Marketplaces are added from the **`+`** button on Discover, accepting a GitHub repository, a Git URL, a local directory or a file.

## Picking a location

- Personal and cross-project → user scope (`~/.zcode/...` or `~/.agents/...`).
- Shared with a team and versioned with the repo → workspace scope.
- Shared with other tools (Claude, Codex, Cursor) → `~/.agents/skills/`. To shadow a same-named skill only inside ZCode, use `.zcode/skills/`.
- Broad personal instructions → `~/.zcode/AGENTS.md`; project rules → `<repo>/AGENTS.md`.
- MCP servers → user config for personal ones, workspace config to share with a team; both auto-connect. Since opening a project now connects the servers it declares, only open repositories you trust.
- Secrets → never commit them. Use environment variables or local settings.

## Routing: which diagnostic skill to load

When a configuration is read but has no effect, or reports an error, load the matching skill. Each one runs a symptom → cause → check → fix workflow and covers both the client action and the file-and-field edit an agent should make.

- MCP server will not connect, tools missing, untrusted, or timing out → **`diagnosing-mcp`**
- Skill not discovered, not triggering, shadowed, or disabled → **`diagnosing-skills`**
- `/command` missing, overridden, bad frontmatter, or arguments not substituting → **`diagnosing-commands`**
- Hook not triggering, matcher not matching, script not executable, or blocking unexpectedly → **`diagnosing-hooks`**
- Plugin not listed, install failing, components missing, or not enabled → **`diagnosing-plugins`**
