---
description: Bring an old ZCode conversation back into the current task and session stores.
argument-hint: "[agent] [workspace] [query or conversation id]"
skills: restore-legacy-sessions
---

Use the `restore-legacy-sessions` skill for this request.

$ARGUMENTS

Anything after the command name is treated as a narrowing filter for the scan, not as
script flags. Map it onto the scan options as follows:

- a provider name such as `glm`, `claude`, `codex`, or `opencode` → `--agent <name>`
- an absolute path → `--workspace <path>`
- free text → `--query "<text>"`
- an id that looks like a task or session id → `--conversation <id>`
- nothing at all → scan everything

Work down the funnel and let the user choose at each step rather than guessing for them:

1. `node scripts/scan-legacy-sessions.mjs summary` — how many conversations exist, and in
   what state.
2. `node scripts/scan-legacy-sessions.mjs agents` — which providers produced them.
3. `node scripts/scan-legacy-sessions.mjs workspaces --agent <provider>` — which
   workspaces.
4. `node scripts/scan-legacy-sessions.mjs conversations --agent <provider>` — which
   conversation, with its title, message count, updated time, and restore state. Add
   `--workspace <path>` when the agent alone is still too broad.

Show the options compactly and ask for one choice at a time unless the arguments above
already narrowed things down to a single row.

Once a conversation is picked, preview it before writing anything:

```bash
node scripts/restore-conversation.mjs --snapshot <path> --dry-run
```

Then apply the same command without `--dry-run`, and report the message and part counts
it prints. Do not write during selection, do not restore more than the conversation the
user chose, and keep the default source `~/.zcode/v2/sessions` unless another source
directory was given explicitly.
