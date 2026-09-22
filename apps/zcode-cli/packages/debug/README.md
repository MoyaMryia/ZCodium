# debug

Development-only trace and context viewer for ZCode.

Run from the repository root:

```sh
pnpm --filter debug dev
```

The Hono API reads existing local diagnostics only:

- `~/.zcodium/cli/log/*.jsonl`
- `~/.zcodium/cli/db/db.sqlite`
- an optional session event JSONL file or directory selected in the UI

It does not modify agent runtime behavior or write back to the agent database.

The API/UI listens on `http://127.0.0.1:4174`. Trace and Gantt views inspect the selected offline sources; the viewer does not intercept network traffic.
