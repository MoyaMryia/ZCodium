---
name: restore-legacy-sessions
description: Use when an old ZCode conversation has to come back — ACP-era session snapshots written under ~/.zcode/v2/sessions that the current build no longer lists or opens. Covers read-only inspection of what still exists (providers, workspaces, individual conversations, and whether each is already present in the new stores), dry-run previews of a restore, and the write itself into ~/.zcode/v2/tasks-index.sqlite and ~/.zcode/cli/db/db.sqlite. Trigger on requests such as recovering a lost chat, bringing back a previous session, migrating v2 sessions, finding out why a task is missing from the list, or comparing tasks-index.sqlite against db.sqlite — including when the user never says the word "legacy".
---

# Restore Legacy Sessions

## 1. Scope

ZCode once stored agent conversations as ACP-era JSON snapshots under
`~/.zcode/v2/sessions`. The current build reads a different pair of stores, so those
snapshots are invisible in the task list even though the files are still on disk. This
plugin moves a chosen snapshot into the current stores.

Two things ship here, and nothing else:

- `scripts/scan-legacy-sessions.mjs` — read-only. Answers "what is out there, and what
  state is it in".
- `scripts/restore-conversation.mjs` — the only writer. Answers "put this one
  conversation into the current stores".

Both are plain Node ESM scripts with no dependencies beyond the standard library. There
is no MCP server, no build step, and no old ACP runtime involved: a restore reads a
snapshot file and writes sqlite rows, nothing more.

Out of scope, deliberately:

- creating or repairing the destination databases — a missing or empty file is an error,
  never a reason to make a new one;
- running the legacy agent/provider that produced the snapshot;
- bulk restore — the writer takes exactly one snapshot path per invocation.

## 2. Locations and identity rules

| thing              | default                          | flag           |
| ------------------ | -------------------------------- | -------------- |
| legacy snapshots   | `~/.zcode/v2/sessions`           | `--legacy-dir` |
| task index         | `~/.zcode/v2/tasks-index.sqlite` | `--task-index` |
| current session DB | `~/.zcode/cli/db/db.sqlite`      | `--cli-db`     |

Snapshots live one directory per workspace: `<legacy-dir>/<workspaceHash>/<legacyTaskId>.json`.
The directory name is the workspace hash, and it must actually be a directory: a JSON file
sitting directly in the legacy root is not picked up at all, so a hand-copied snapshot
needs its workspace-hash folder back. A file ending in `.deleted.json` is one the user
removed on purpose, so the scanner skips it — surfacing it would suggest a restore is
still possible.

Three identity rules decide whether a restored conversation actually shows up:

1. **`restoredTaskId = meta.acpSessionId || meta.taskId`.** The filename and
   `meta.taskId` are historical; the app task list keys off `meta.acpSessionId`. Writing
   the wrong one produces a task that exists in the table but never appears in the list.
2. **`workspaceKey = workspaceIdentity.trim() || workspacePath`.** Identity drives
   isolation, path drives file operations and display. When both are empty the key falls
   back to the path — never to the empty string, which would collapse every
   identity-less workspace into one row.
3. **`projectId = "proj_" + workspacePath` with the leading slash dropped and the
   remaining slashes turned into hyphens.** This matches how existing CLI sessions
   derive theirs; a different formula gives the same workspace two rows in the list.

Restored conversations are ordinary ZCode Agent history, so every persisted provider
field is written as `glm` (`RESTORED_PROVIDER`). The snapshot's own provider is source
context and is reported as such, but it is never what gets stored. The
`migration_source` column is always written `NULL`: that enum belongs to the Claude Code
native import path, and an ACP-era restore that fills it gets mistaken for a different
migration chain.

## 3. The eight modules

Everything lives in `scripts/` next to this file. Six of the eight are libraries with no
command-line entry of their own.

| module                     | responsibility                                                                   | CLI entry |
| -------------------------- | -------------------------------------------------------------------------------- | --------- |
| `scan-legacy-sessions.mjs` | argument parsing and dispatch for the read-only scan                             | yes       |
| `restore-conversation.mjs` | argument parsing, restore plan, two-store transaction                            | yes       |
| `legacy-scan.mjs`          | snapshot discovery, store-status probing, filtering, grouping, table/JSON output | no        |
| `legacy-snapshot.mjs`      | reading and normalizing one snapshot; shared by both entry points                | no        |
| `legacy-store.mjs`         | the write layer: validation, backup, and the three-table upsert                  | no        |
| `legacy-parts.mjs`         | projecting a legacy message into `part` rows                                     | no        |
| `legacy-sqlite.mjs`        | loading `node:sqlite` and opening a database read-only or writable               | no        |
| `legacy-values.mjs`        | coercion helpers shared by every other module                                    | no        |

Import graph (read bottom-up; `legacy-values.mjs` is the leaf everything sits on):

```text
scan-legacy-sessions.mjs
└─ legacy-scan.mjs
   ├─ legacy-sqlite.mjs      openReadOnly()
   └─ legacy-snapshot.mjs
      └─ legacy-values.mjs

restore-conversation.mjs
├─ legacy-values.mjs         plan field coercion
├─ legacy-snapshot.mjs       read + normalize
├─ legacy-sqlite.mjs         openWritable()
└─ legacy-store.mjs          validation, backup, two-store write
   ├─ legacy-values.mjs
   ├─ legacy-snapshot.mjs    RESTORED_PROVIDER, SESSION_SCHEMA_VERSION, role/time helpers
   └─ legacy-parts.mjs       part row projection
      ├─ legacy-values.mjs
      └─ legacy-snapshot.mjs
```

### `legacy-values.mjs` — coercion leaf

`asText`, `asNumber`, `compact`, `asObject`, `asStoredText`, `summarizeText`. Every
other module funnels raw snapshot values through these, which is the point: one
definition of "a usable string" stops the scanner and the writer from disagreeing about
whether a field is present. `asNumber` rejects `NaN` and `Infinity`, `asObject` treats
arrays and `null` as empty, `asStoredText` keeps strings verbatim and JSON-encodes the
rest so a column never ends up holding the literal text `null`. `summarizeText`
collapses whitespace and truncates at 80 characters.

### `legacy-sqlite.mjs` — one place that touches `node:sqlite`

`openReadOnly(path)` returns `null` when the file is missing, empty, or not a database —
the caller records that as "missing" and carries on. `openWritable(path)` throws when
`node:sqlite` cannot be loaded at all, because a restore has no degraded mode.
`isSqliteAvailable()` reports the load result.

The module exists for one narrow reason: `node:sqlite` is still experimental on some
Node versions, and its load emits a warning that reads like a failure when it lands in
the middle of human-facing output. The suppression window covers the import and nothing
else, so real warnings still get through. Loading failure is _not_ raised here — the
decision to error or degrade belongs to the caller.

### `legacy-snapshot.mjs` — the shared reader

`readLegacySnapshot(filePath)` parses one file and returns a normalized view:
`legacyTaskId`, `acpSessionId`, `restoredTaskId`, `workspacePath`,
`workspaceIdentity`, `provider`, `model`, timestamps, `messages`, `messageCount`,
role counts, and `visibleText`. A file that fails to parse returns an object carrying
`error` instead of throwing — one broken file must not abort a whole scan, and the user
still needs to know it is there.

The module also owns the deliberate split between the two title policies:
`scanTitleOf` falls back to a summary of the first user message (most old snapshots
have no `meta.title`, and an untitled row is unpickable), while `restoreTitleOf` uses
`meta.title` only — a restore that invented a title from the body would give the user a
name they never chose.

Exports used elsewhere: `RESTORED_PROVIDER` (`"glm"`), `SESSION_SCHEMA_VERSION`
(`"0.14.5"`), `workspaceKeyOf`, `projectIdFor`, `normalizeRestoreMeta`, plus
`messageRole` / `messageText` / `messageCompletedAt` for the writers. `messageRole`
treats anything that is not exactly `assistant` as `user`, because old snapshots
contain empty roles. `messageCompletedAt` adds `durationMs` to an explicit timestamp and
otherwise falls back rather than writing an undefined time.

`normalizeRestoreMeta` rewrites `provider` to `glm`, pins `taskId` to `restoredTaskId`,
keeps the original id in `legacyTaskId` and `restoredTaskId`, defaults `mode` to `build`,
and defaults `traceId` to `zcode-<restoredTaskId>` when the snapshot has none.

### `legacy-scan.mjs` — the read-only scan

Exports `collectSnapshotFiles`, `filterCandidates`, `summarizeGroups`, `markdownTable`,
`formatTime`, `printAgents`, `printWorkspaces`, `printConversations`, `printSummary`,
and the entry point `runScan(args)`.

It never writes. Destination tables that cannot be opened are recorded as missing, not
created or repaired — the scan's job is to report the state of the world, not to fix it.

Two boundaries worth knowing:

- `scanSnapshot` reads through `legacy-snapshot.mjs` and then **drops `messages` and
  `meta`** before anything is printed. `conversations --json` serializes its rows
  directly, so keeping them would dump entire conversation bodies and raw metadata into
  one listing command. The restore path needs those fields, which is why they stay in
  the reader and are cut at the scan boundary. `visibleText` is likewise stripped from
  JSON output.
- `attachStoreStatus` probes both destination stores read-only and labels each candidate
  with a `store` object (`cliDb`: `present`/`missing`; `taskIndex`:
  `present`/`legacy-task-id`/`missing`) plus a derived `restoreState`.
  `legacy-task-id` means the task row exists under the old id rather than the restored
  one — it counts as present in the store, but restoring converges it onto the new id.

`--agent all` is an explicit "do not filter" and behaves exactly like omitting the flag,
so a nonexistent provider called `all` never blocks the scan.

### `legacy-store.mjs` — the write layer

`ensurePopulatedDb(path, label)` rejects a missing file, a non-file, and a zero-byte
file; an empty file is silently treated as a brand-new database by sqlite, after which
every query fails for no visible reason.

`backupDb(path)` copies to `<path>.bak-<ISO timestamp>` before any write. Repeated
restores leave multiple backups on purpose: a rollback needs a point to choose.

`writeRestore(taskDb, cliDb, plan, log)` performs the actual upserts across three tables
and reports its progress through the `log` callback. The caller owns the transaction
boundary.

- **tasks** (`tasks-index.sqlite`) — upsert on `(workspace_key, task_id)`. New data
  goes in, user edits stay: `title` is only replaced when `title_overridden = 0`,
  `created_at` takes the earlier value and `updated_at` the later so the timeline never
  moves backwards, `unread_at` is left alone because it is reading state, and
  `searchable_text` is only replaced when the target row is not newer. `provider` is
  forced to `glm`, `migration_source` is forced to `NULL`.
- **session** (`db.sqlite`) — upsert on `id`. `title_source = 'custom'` means the user
  renamed it in the list, so the title is preserved. `trace_id` goes through `COALESCE`,
  keeping an existing value: a replay that swapped in a fresh trace would break the
  chain. `version` is `SESSION_SCHEMA_VERSION`, `workspace_id` is the workspace hash,
  `slug` is the restored task id, and `task_type` is `interactive`.
- **message** and **part** — messages get ids of the form
  `msg_legacy_<restoredTaskId>_<index>`; parts get
  `part_legacy_<restoredTaskId>_<messageIndex padded to 4>_<partIndex padded to 4>`.
  The padding makes lexicographic order equal chronological order, which the list query
  depends on to reconstruct a conversation. Before rewriting, parts matching
  `part_legacy_<restoredTaskId>_%` are deleted, so a second restore replaces rather than
  accumulates.

Message `data` follows the current message contract and carries no legacy identity
fields — writing the old shape would force the normal read path through a legacy codec
and turn freshly restored data into data that needs migrating again.

### `legacy-parts.mjs` — making the history visible

The detail page renders from the `part` table. Writing only `message.data.content`
yields a task that opens with an empty history area — a pure presentation defect that is
invisible from the database, which is exactly why this module exists.

`buildPartDataList(message, messageId, messageTimestamp)` returns the part list for one
message. Two snapshot generations are handled:

- **with a `parts` array** (assistant messages): the array's own order is preserved, so
  reasoning, text, and tool calls stay interleaved as they happened.
- **flat `content` + `tools`**: parts are synthesized in a fixed order — reasoning, then
  text, then tools.

Either way, if neither path produced visible text and the message does have content, a
final `text` part is appended. An unrecognized shape must not silently swallow what the
user typed.

Tool parts carry `type: "tool"`, a resolved `callID`, a resolved tool name, and a
`state` object. Timestamps live in `state.time` because that is what the session-store
persists and what the read mapping looks for; writing the protocol-level
`startedAt`/`completedAt` fields instead leaves the reader unable to find the times.
Status mapping is `running` and `pending` pass through (pending carries no end time, no
title, and no metadata, since it produced nothing), `failed`/`error`/`denied` all
collapse to `error` with the original name preserved in metadata, and everything else is
`completed`.

Tool names are resolved from `raw._meta.claudeCode.toolName` first — the most accurate
record Claude Code keeps — then from the flat fields, and finally to the placeholder
`legacy_tool`, because an empty name renders as a blank row.

## 4. Command-line entry points

Resolve script paths against this `SKILL.md`'s directory. When the working directory is
somewhere else, use the absolute path inside the plugin cache.

### `scan-legacy-sessions.mjs`

```text
scan-legacy-sessions.mjs [summary|agents|workspaces|conversations] [options]
```

| option           | meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `--legacy-dir`   | legacy snapshot root (default `~/.zcode/v2/sessions`)                              |
| `--task-index`   | task index sqlite (default `~/.zcode/v2/tasks-index.sqlite`)                       |
| `--cli-db`       | current session sqlite (default `~/.zcode/cli/db/db.sqlite`)                       |
| `--agent`        | filter by provider, e.g. `glm`, `claude`, `codex`, `opencode`; `all` = none        |
| `--workspace`    | filter by exact workspace path                                                     |
| `--query`        | filter by title, ids, provider, workspace path, or message body (case-insensitive) |
| `--conversation` | filter by restored task id, legacy task id, or ACP session id                      |
| `--limit`        | conversation row cap, default `30`                                                 |
| `--json`         | print JSON instead of a Markdown table                                             |

The subcommand defaults to `summary`. An unrecognized one prints
`Unknown command: <name>` followed by the usage block and exits `1`.

`--help` / `-h` print the usage block, but only _after_ a subcommand token. Passing
`--help` as the first argument makes it the subcommand, which produces
`Unknown command: --help` plus usage and exit `1`. The usage text is also printed to
stdout whenever argument parsing fails, so the flag is a convenience rather than the only
route to it.

`--limit` falls back to `30` when the value is not a positive finite number; a typo like
`--limit abc` should not cost the user the whole scan.

### `restore-conversation.mjs`

```text
restore-conversation.mjs --snapshot <path> [--task-index <path>] [--cli-db <path>] [--dry-run]
```

| option         | meaning                                                      |
| -------------- | ------------------------------------------------------------ |
| `--snapshot`   | legacy snapshot JSON path — **required**                     |
| `--task-index` | task index sqlite (default `~/.zcode/v2/tasks-index.sqlite`) |
| `--cli-db`     | current session sqlite (default `~/.zcode/cli/db/db.sqlite`) |
| `--dry-run`    | print the plan and stop; no writes, no backups               |

There is no `--help`: every flag is expected to take a value, so `--help` fails with
`Missing value for --help` and exit `1`. A missing `--snapshot` fails with
`--snapshot is required`.

The run is two phases. `buildPlan` reads the snapshot and derives every field the write
needs — a pure function that touches neither database nor filesystem. `printPlan` shows
it, and then either the run stops (dry run) or `applyRestore` executes it. Because both
paths consume the same plan object, what a dry run prints is exactly what a real run
writes.

## 5. Selection workflow

Selection comes before mutation. Work down the funnel and let the user decide at each
step rather than guessing:

```bash
node scripts/scan-legacy-sessions.mjs summary
node scripts/scan-legacy-sessions.mjs agents
node scripts/scan-legacy-sessions.mjs workspaces --agent claude
node scripts/scan-legacy-sessions.mjs conversations --agent claude --workspace /path/to/project
```

Narrow with `--query "<text>"` (title, ids, or message body) or `--conversation <id>`
when the user already knows which one they mean. Add `--json` when the output feeds `jq`
or another script.

`--agent` and `--workspace` appear as required in the synopsis but are not enforced by
the parser; omitting them simply scans everything.

When presenting options, show one row per conversation with its title, updated time,
message count, `restoredTaskId`, and restore state, and tell the user which filter to use
when the list is long. Ask for a single choice at a time unless the request already
narrowed things down.

Once one conversation is chosen, preview it before touching anything:

```bash
node scripts/restore-conversation.mjs \
  --snapshot ~/.zcode/v2/sessions/<workspaceHash>/<legacyTaskId>.json \
  --dry-run
```

Then apply, with no `--dry-run`:

```bash
node scripts/restore-conversation.mjs \
  --snapshot ~/.zcode/v2/sessions/<workspaceHash>/<legacyTaskId>.json
```

## 6. Restore states

The two stores are independent, so a candidate lands in one of four states:

| state               | meaning                                    | what to do |
| ------------------- | ------------------------------------------ | ---------- |
| `ready`             | both stores already hold the restored id   | nothing    |
| `needs-cli-db`      | task index has it, the session DB does not | restore    |
| `needs-task-index`  | session DB has it, the task index does not | restore    |
| `needs-full-import` | neither store has it                       | restore    |

Only `ready` is a no-op; the other three all mean "run the restore". Restoring over a
partial state is safe and is in fact how the two halves converge.

## 7. What an applied restore writes

In order:

1. Both destination files are validated as existing, non-empty sqlite databases.
2. Both are copied to timestamped `.bak-*` siblings, and the paths are printed.
3. Both are opened writable and each begins its own `BEGIN IMMEDIATE`.
4. The tasks row is upserted, then the session row, then the messages and their parts.
5. Both commit. On any failure both roll back.

The final console block reports message and part row counts, which is the cheapest check
that the projection did what it claimed.

## 8. Failure semantics

| situation                             | outcome                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| snapshot JSON does not parse          | counted as `invalid`, excluded from grouping, scan continues, exit `0`  |
| `~/.zcode/v2/sessions` does not exist | zero conversations, exit `0`                                            |
| destination file missing              | `<label> not found: <path>`, exit `1`, before any backup                |
| destination file empty or not sqlite  | `<label> is not a populated sqlite file: <path>`, exit `1`              |
| `node:sqlite` unavailable             | `node:sqlite is unavailable: <reason>` from the writable open, exit `1` |
| snapshot has no `workspacePath`       | `Snapshot has no workspacePath: <path>`, exit `1`, no writes            |
| unknown option / missing value        | `Unknown option: <x>` / `Missing value for <x>`, exit `1`               |
| failure mid-transaction               | both databases rolled back, `Restore failed: <reason>`, exit `1`        |
| a rollback itself fails               | `Rollback failed: <reason>` is reported separately, original error kept |

The plan is always printed before the first write, so a failure after that point still
leaves a readable account of what was attempted.

## 9. Guardrails

- Never write during selection. Scanning is read-only by construction; keep it that way.
- Always dry-run first, and show the user the plan before applying.
- Never overwrite a real session the user has already continued. Each upsert names the
  columns it writes and leaves every other column alone, so `pinned`, `archived`, and
  `deleted` survive untouched; `title_overridden`, `unread_at`, and
  `title_source = 'custom'` are additionally read explicitly and honored. Re-running the
  same restore is a no-op in effect.
- Never start a legacy runtime to "check" a snapshot. The snapshot file is the whole
  source of truth.
- Treat the snapshot provider as source context only. Persisted provider fields are
  `glm`.
- Leave `migration_source` empty. The upsert forces it to `NULL`, which also clears a
  value left behind by an older restore.
- Keep `meta_json.taskId` equal to `restoredTaskId`, never the historical snapshot
  `meta.taskId`.
- Do not touch implementation code from this skill. If app code has to change, write the
  spec first and run `pnpm typecheck` and `pnpm lint`.
