# zcode-guide

The official built-in ZCode plugin for configuring the client's extension resources, diagnosing them when they misbehave, and authoring dynamic workflows. It is content-only — one slash command and seven skills, no scripts and no MCP servers — and it ships enabled, so a fresh install already has `/workflow` and every skill below.

## What it provides

| Component                   | What it covers                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workflow` (command)       | Entry point that turns an explicit workflow request into a `CreateWorkflow` run; mounts the `dynamic-workflows` skill before the body runs                                                                                                               |
| `zcode-configuration-guide` | The map: where MCP servers, commands, skills, hooks and plugins are configured at user and workspace scope, the discovery order, precedence and merge rules, and which location to pick                                                                  |
| `diagnosing-mcp`            | Servers that will not connect, whose tools do not appear, that time out, or that a configuration file silently fails to define                                                                                                                           |
| `diagnosing-skills`         | Skills that are not discovered, do not trigger, are shadowed by a same-name skill, are disabled, or have a frontmatter error                                                                                                                             |
| `diagnosing-commands`       | Slash commands that are missing, overridden by a higher-precedence duplicate, dropped for an invalid name or empty body, or whose arguments do not substitute                                                                                            |
| `diagnosing-hooks`          | Hooks that never fire, whose matcher misses, whose script is not executable, that time out, or that block a session                                                                                                                                      |
| `diagnosing-plugins`        | Plugins that are not listed, fail to install or update, or are enabled while their components are missing                                                                                                                                                |
| `dynamic-workflows`         | How to write `CreateWorkflow` scripts: subagent topology, typed results, deterministic gates, reporting and artifacts, and revising a run after submission. `patterns.md` and `examples.md` ship beside it as the shape catalogue and the worked scripts |

## Design principle

Every diagnosis resolves to one concrete action. For a person that is a thing to inspect and change in the client — Settings (Commands / Skills / MCP Servers / Hooks / Plugins) and the `/` menu. For an agent it is the specific configuration file and field to edit, reached with `zcode commands list`, `zcode skills list` and the file reads each skill names. The intent is that an agent can diagnose and repair a ZCode installation from these skills alone, without a human in the loop.

## Enablement

The plugin is registered as an official built-in and enabled by default. Turning it off in Settings → Plugins disables the whole package at once: a disabled plugin contributes no skill roots and no command roots, so `/workflow` and all seven skills disappear together until it is switched back on.
