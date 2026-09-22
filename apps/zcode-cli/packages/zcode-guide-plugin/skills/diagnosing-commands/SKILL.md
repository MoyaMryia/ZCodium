---
name: diagnosing-commands
description: Use to diagnose and fix ZCode custom slash-command (/command) configuration problems in the ZCode client. Applies when a command is missing from the / menu, is overridden by a higher-precedence command of the same name, has a frontmatter parse error, is dropped for an invalid name or an empty body, does not substitute $ARGUMENTS/$1, has a misspelled frontmatter key, is hidden because its name collides with a built-in command, is disabled by configuration, or disappears because the plugin providing it is disabled. Provides the discovery order, how to inspect commands from the client and the CLI, common pitfalls, and a step-by-step localization and repair workflow.
---

# Diagnosing Command Configuration

The goal is one concrete fix per problem.

A person inspects commands from the **`/` menu** (Commands group) in the input box, or from **Settings → Commands**. An agent reads the command files at the locations below, or runs `zcode commands list` / `zcode commands inspect <name>` for the discovered set with its diagnostics.

> Two facts get missed often: a command is a `.md` file whose **file name is the command name**, and nested names join with a **colon**, so `review/code.md` is `/review:code` and not `/review/code`.

## 1. Discovery order

Scanned earliest-first, and the first location that defines a name wins:

1. Explicitly configured command roots
2. User `~/.zcodium/commands`, then `~/.agents/commands`
3. Workspace `.zcodium/commands` and `.agents/commands` — from the working directory up to the repository root, every level counted
4. Enabled **plugin** command roots, last

Inside a level `.zcodium` comes before `.agents`. Subdirectories are walked recursively (symlinks included, depth-capped), and each nesting level joins into the name with a colon.

## 2. Deduplication: first match wins

The key is the **normalized command name** — the path relative to its root with `.md` stripped, separators turned into `:`, lowercased. The **first occurrence, meaning the highest-precedence location, wins**: user beats workspace, `.zcodium` beats `.agents`, local files beat plugins. Every later duplicate is ignored and surfaces as a `custom_command_duplicate_name` warning diagnostic.

There is also an **interactive-surface-only** filter: a command whose name collides with a built-in slash command or its aliases (`init`, `compact`, `expert`, `goal`, `model`, `plugins`, …), or with `compress` or `plan`, is hidden from the live `/` menu while remaining on disk — and a command marked `disable-noninteractive: true` is hidden the same way. Neither filter changes what discovery returns, so `zcode commands list` still shows them.

## 3. The `.md` format

- The name comes from the file name and must match `^[a-z0-9][a-z0-9_:-]{0,63}$` — lowercase alphanumeric start, no spaces or dots, no leading `-` or `_`, at most 64 characters. A violation drops the command with an error diagnostic.
- Frontmatter uses a flat parser that ignores indented lines and comments, and recognizes `description`, `argument-hint`, `allowed-tools`, `model`, `skills` and `disable-noninteractive`, all hyphenated. An unknown key is ignored and the command still loads (with a warning).
- **A description or a non-empty body is required**, otherwise the command is dropped. With no `description`, the first non-empty body line is used instead.
- Argument substitution: `$ARGUMENTS` is the whole argument string; `$1` and `$2` are positional and out-of-range ones come out empty. When arguments are supplied but no placeholder appears, they are appended under a "User arguments:" heading.
- `skills` are mounted automatically: the expanded prompt carries a "Required skills" preamble instructing the agent to call the Skill tool for them before following the command body.
- Dynamic shell is executed, not rejected: on the session prompt path an inline `` !`cmd` `` or a fenced `!` block runs through the session's execution port with a 30-second timeout and a 128 KB output cap, and a nonzero exit fails the command with an error naming the command and its exit status. Paths without an execution port refuse the expansion outright with an "unsupported shell expansion" error. `${ZCODE_PLUGIN_ROOT}`-style variables need a plugin context, `${ZCODE_SESSION_ID}` needs a runtime session, and `${ZCODE_SKILL_DIR}` is never available in a command.

## 4. Inspecting commands

- **Client**: type **`/`** in the input box and open the **Commands** group; keyword search works. Each entry shows its name and description. **Settings → Commands** lists the full set, plugin-provided ones included.
- **Agent**: `zcode commands list` prints every discovered command with its `scope/source` and path; `zcode commands inspect <name>` adds the frontmatter fields, size and diagnostics (`--verbose` shows the diagnostics on either). Reading the `.md` files directly in discovery order works too — and remember that for a given name only the **first** in that order ever runs.

## 5. Pitfalls, by symptom

1. **Missing, wrong directory.** The `.md` is not under a scanned root — a singular `.zcodium/command/`, or somewhere above the repository root. → Move it to `~/.zcodium/commands/` or `<repo>/.zcodium/commands/`.
2. **Missing, invalid name.** The file is there but no command appears: the name breaks the pattern through uppercase, spaces, dots, a leading `-` or `_`, or length over 64. → Rename to a valid lowercase name, and namespace with subdirectories, which become `:`, not with dots.
3. **A different command runs.** A higher-precedence duplicate took the slot; first match wins. → Find the copy that outranks yours in discovery order and rename or remove it. Local files always beat plugins.
4. **A frontmatter key is silently gone.** The flat parser reads only single-line top-level keys, so indented lines and multi-line arrays are dropped. → Keep every value on one line and write lists inline, e.g. `allowed-tools: Read, Bash`.
5. **Empty command dropped.** Both description and body are empty. → Add a `description:` or at least one non-empty body line.
6. **A frontmatter key has no effect.** Likely a misspelling. → Use the hyphenated forms: `allowed-tools` rather than `allowed_tools`, plus `argument-hint` and `disable-noninteractive`.
7. **`$ARGUMENTS` or `$1` does not substitute.** Either the body has no placeholder — arguments are appended under "User arguments:" by design — or `$1` is out of range, or a form like `${ARGUMENTS}` is simply not recognized. → Use the exact `$ARGUMENTS` / `$1` tokens.
8. **A shell expansion fails.** The command reports that its expansion failed, or that shell expansion is unsupported: the inline or fenced block exited nonzero, it referenced a context variable that does not exist here (`${ZCODE_SKILL_DIR}`, a session variable with no session, a plugin variable in a non-plugin command), or the command ran on a path with no execution port. → Fix the command or its context, or drop the expansion and use static text or `$ARGUMENTS`.
9. **A plugin command is missing.** A disabled plugin contributes no command roots, or a local same-named file shadows it. → Enable the plugin in **Settings → Plugins** and make sure no local duplicate outranks it.
10. **A valid command silently disappears.** Configuration disabled it by the file's absolute path, not by command name. → Set that path's `enable` to `true` in the `command` overrides, or remove the entry.
11. **`/` versus `:` confusion.** `/review/code` reports not found although `review/code.md` exists, because subdirectories map to `:` and the real name is `review:code`. → Invoke `/review:code`.
12. **Reserved-name collision, interactive only.** The command is on disk but cannot be fired from the live `/` menu, and typing the name sends it as a plain prompt instead of running it, because the name matches a built-in slash command or `compress`. → Rename it to something unreserved.
13. **The `/workflow` command is gone.** The bundled `zcode-guide` plugin provides it, and it is removed from the `/` menu — and refused at expansion — while the dynamic-workflow feature is switched off for this session. → Re-enable dynamic workflows; nothing in the command file itself is wrong.

## 6. Narrowing it down

1. **Is it in the `/` menu?** Open the Commands group. Absent → step 2. Present but the wrong content runs → step 4, a duplicate.
2. **Confirm the file and its root.** The `.md` must sit under a scanned commands root for the current working directory — pitfall 1 — and its name must be valid — pitfall 2.
3. **Check the frontmatter.** A missing or garbled key points at the flat-parser rules (pitfall 4) or an empty command (pitfall 5); a key that does nothing is probably misspelled (pitfall 6).
4. **Resolve the duplicate.** For a given name the winner is first in discovery order; find the copy you do not want and rename or remove it.
5. **Check the body.** Verify the argument placeholders (pitfall 7) and that any shell expansion can actually run here (pitfall 8).
6. **Still missing with no obvious cause?** Look for a configuration disable (pitfall 10, by absolute file path), a disabled plugin (pitfall 9), reserved-name filtering (pitfall 12), or the dynamic-workflow gate (pitfall 13).
