---
name: diagnosing-commands
description: Use to diagnose and fix ZCode custom slash-command (/command) configuration problems in the ZCode client. Applies when a command is missing, is overridden by a higher-precedence command of the same name, has a frontmatter parse error, is dropped for having an empty body, has an invalid name, does not substitute $ARGUMENTS/$1, uses a colon rather than a slash for nested names, has a misspelled frontmatter key, or disappears because the plugin providing it is disabled. Provides the discovery order, how to inspect commands in the client, common pitfalls, and a step-by-step localization and repair workflow.
---

# Diagnosing Command Configuration

The goal is one concrete fix per problem.

A person inspects commands from the **`/` menu** (Commands group) in the input box. An agent reads the command files at the locations below.

> Two facts get missed often: nested names join with a **colon**, so `review/code.md` is `/review:code` and not `/review/code`; and a command is a `.md` file whose **file name is the command name**.

## 1. Discovery order

Scanned earliest-first:

1. Explicitly configured roots
2. User `~/.zcode/commands`
3. User `~/.agents/commands`
4. Workspace `.zcode/commands` — from the working directory up to the repository root, every level counted
5. Workspace `.agents/commands`
6. Enabled **plugin** command roots, last

Inside a level `.zcode` comes before `.agents`. Subdirectories are walked recursively, and each nesting level joins into the name with a colon.

## 2. Deduplication: first match wins

The key is the **normalized command name** — the relative path with `.md` stripped, separators turned into `:`, lowercased. The **first occurrence, meaning the highest-precedence location, wins**: user beats workspace, `.zcode` beats `.agents`, local files beat plugins. The rest are ignored.

There is also an **interactive-surface-only** filter: a command whose name collides with a built-in slash command, or with `compress`, is hidden from the live `/` menu while remaining on disk.

## 3. The `.md` format

- The name comes from the file name and must match `^[a-z0-9][a-z0-9_:-]{0,63}$` — lowercase alphanumeric start, no spaces or dots, no leading `-` or `_`, at most 64 characters. A violation drops the command.
- Frontmatter uses a flat parser that ignores indented lines, and recognizes `description`, `argument-hint`, `allowed-tools`, `model`, `skills` and `disable-noninteractive`, all hyphenated. An unknown key is ignored and the command still loads.
- **A description or a non-empty body is required**, otherwise the command is dropped. With no `description`, the first non-empty body line is used instead.
- Argument substitution: `$ARGUMENTS` is the whole argument string; `$1` and `$2` are positional and out-of-range ones come out empty. When arguments are supplied but no placeholder appears, they are appended under a "User arguments:" heading.
- `skills` are mounted automatically. Inline dynamic shell — `` !`cmd` `` or a fenced `!` block — is rejected.

## 4. Inspecting commands

- **Client**: type **`/`** in the input box and open the **Commands** group; keyword search works. Each entry shows its name and description.
- **Agent**: read the `.md` files in discovery order, derive each name from its path (subdirectories become `:`), and remember that for a given name only the **first** in that order ever runs.

## 5. Pitfalls, by symptom

1. **Missing, wrong directory.** The `.md` is not under a scanned root — a singular `.zcode/command/`, or somewhere above the repository root. → Move it to `~/.zcode/commands/` or `<repo>/.zcode/commands/`.
2. **Missing, invalid name.** The file is there but no command appears: the name breaks the pattern through uppercase, spaces, dots, a leading `-` or `_`, or length over 64. → Rename to a valid lowercase name, and namespace with subdirectories, which become `:`, not with dots.
3. **A different command runs.** A higher-precedence duplicate took the slot; first match wins. → Find the copy that outranks yours in discovery order and rename or remove it. Local files always beat plugins.
4. **A frontmatter key is silently gone.** The flat parser reads only single-line top-level keys, so indented lines and multi-line arrays are dropped. → Keep every value on one line and write lists inline, e.g. `allowed-tools: Read, Bash`.
5. **Empty command dropped.** Both description and body are empty. → Add a `description:` or at least one non-empty body line.
6. **A frontmatter key has no effect.** Likely a misspelling. → Use the hyphenated forms: `allowed-tools` rather than `allowed_tools`, plus `argument-hint` and `disable-noninteractive`.
7. **`$ARGUMENTS` or `$1` does not substitute.** Either the body has no placeholder — arguments are appended under "User arguments:" by design — or `$1` is out of range, or a form like `${ARGUMENTS}` is simply not recognized. → Use the exact `$ARGUMENTS` / `$1` tokens.
8. **Dynamic shell rejected.** Running the command reports an unsupported shell expansion because the body holds `` !`...` `` or a fenced `!` block. → Remove it; use static text or `$ARGUMENTS`.
9. **A plugin command is missing.** A disabled plugin contributes no command roots, or a local same-named file shadows it. → Enable the plugin in **Settings → Plugin Management** and make sure no local duplicate outranks it.
10. **A valid command silently disappears.** Configuration disabled it by the file's absolute path, not by command name. → Set that path's `enable` to `true`, or remove the entry.
11. **`/` versus `:` confusion.** `/review/code` reports not found although `review/code.md` exists, because subdirectories map to `:` and the real name is `review:code`. → Invoke `/review:code`.
12. **Reserved-name collision, interactive only.** The command is on disk but cannot be fired from the live `/` menu because its name matches a built-in slash command or `compress`. → Rename it to something unreserved.

## 6. Narrowing it down

1. **Is it in the `/` menu?** Open the Commands group. Absent → step 2. Present but the wrong content runs → step 4, a duplicate.
2. **Confirm the file and its root.** The `.md` must sit directly under a scanned commands root for the current working directory — pitfall 1 — and its name must be valid — pitfall 2.
3. **Check the frontmatter.** A missing or garbled key points at the flat-parser rules (pitfall 4) or an empty command (pitfall 5); a key that does nothing is probably misspelled (pitfall 6).
4. **Resolve the duplicate.** For a given name the winner is first in discovery order; find the copy you do not want and rename or remove it.
5. **Check the body.** Verify the argument placeholders (pitfall 7) and that no rejected dynamic shell remains (pitfall 8).
6. **Still missing with no obvious cause?** Look for a configuration disable (pitfall 10, by absolute file path), a disabled plugin (pitfall 9), or reserved-name filtering (pitfall 12).
