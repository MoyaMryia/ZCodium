# Restore Legacy Sessions

An official ZCode plugin that brings conversations recorded by older ZCode builds back
into the current task and session stores.

## The problem it solves

ZCode used to keep each agent conversation as a JSON snapshot on disk, one file per
conversation under a per-workspace directory:

```text
~/.zcode/v2/sessions/<workspaceHash>/<legacyTaskId>.json
```

Current builds read a different pair of stores — a task index and a CLI session
database. Nothing migrates the old files on upgrade, so after upgrading, those
conversations are still sitting on disk but no longer appear in the task list and cannot
be opened. The files are not corrupted; they are simply not being read.

This plugin reads one of those snapshots and writes it into the current stores as
ordinary ZCode history, so the conversation reappears in the list and opens normally.

## Install

The plugin ships inside the official marketplace as
`restore-legacy-sessions@zcode-plugins-official`. Because it writes to local data, it is
discovered but stays disabled until you turn it on:

```sh
zcode plugins enable restore-legacy-sessions
```

Or, from inside a session:

```text
/plugins enable restore-legacy-sessions
```

Capability changes apply to new sessions, so start one after enabling. Then invoke it:

```text
/restore-legacy-sessions
```

To turn it off again, `zcode plugins disable restore-legacy-sessions` or
`/plugins disable restore-legacy-sessions`.

## What it touches

| role               | path                             |
| ------------------ | -------------------------------- |
| source (read-only) | `~/.zcode/v2/sessions`           |
| destination        | `~/.zcode/v2/tasks-index.sqlite` |
| destination        | `~/.zcode/cli/db/db.sqlite`      |

Every restore validates both destination files, copies each one to a timestamped
`.bak-*` sibling before the first write, and commits the two databases together — either
both change or neither does. Rows the user has already edited are preserved: a renamed
title, a pinned or archived task, and the unread marker all survive a re-restore, and
restoring the same snapshot twice does not duplicate messages or parts.

Restored conversations are stored as normal `glm` ZCode Agent history. The provider
recorded in the old snapshot is kept as source context only, and the
`migration_source` column is left empty because that field belongs to a different import
path.

## What is inside

```text
restore-legacy-sessions-plugin/
├── .zcode-plugin/plugin.json
├── commands/restore-legacy-sessions.md     /restore-legacy-sessions
├── package.json
└── skills/restore-legacy-sessions/
    ├── SKILL.md                            how to drive the scripts
    └── scripts/
        ├── scan-legacy-sessions.mjs        CLI — read-only inspection
        ├── restore-conversation.mjs        CLI — the only writer
        ├── legacy-scan.mjs                 discovery, store status, output
        ├── legacy-snapshot.mjs             snapshot reader + normalizer
        ├── legacy-store.mjs                validation, backup, upserts
        ├── legacy-parts.mjs                message → part rows
        ├── legacy-sqlite.mjs               node:sqlite loading
        └── legacy-values.mjs               coercion helpers
```

The two CLI scripts are the entry points; the six `legacy-*` modules are libraries they
import. `SKILL.md` documents each module, the selection workflow, and the failure modes.

## Development

This is a skills-and-commands plugin. There is no MCP server and no build step, and the
scripts depend on nothing outside Node's standard library — they use `node:sqlite`
(Node 22.5 or newer). A Node build without it makes the writable open fail with an
explicit error rather than a partial write. Repository checks (`pnpm typecheck`,
`pnpm lint`) are run from the repository root.
