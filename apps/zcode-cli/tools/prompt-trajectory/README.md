# @zcode/prompt-trajectory

Offline conversion of existing trajectory and Model-IO files supplied by the user.
The tool runs under `tools/` and stays outside production CLI and SEA packaging.

## Commands

```bash
pnpm --filter @zcode/prompt-trajectory derive -- \
  --input /path/to/existing-trajectory.jsonl \
  --out /tmp/zcode-prompt-trajectory/converted

pnpm --filter @zcode/prompt-trajectory model-io -- \
  --input /path/to/existing-model-io.jsonl \
  --out /tmp/zcode-prompt-trajectory/converted-model-io
```

Both commands require an explicit input file. `derive` accepts
`--reference-request <path>` to copy an existing reference into
`<out>/raw/reference-request-body.raw.json`.

The converter writes a manifest and OpenAI-compatible and Anthropic request
snapshots under `<out>/trajectories`. Model-IO conversion also writes
`<out>/anthropic_trajectory.json`.

Model-IO delta records are expanded before filtering. The default query source is
`main_turn`; use `--query-source <value>` to select another source. Sidecar records
are excluded when their source differs.

Continuity comparison ignores `cache_control` drift. Additional thinking blocks
and appended user content remain in the same trajectory when the earlier
messages match. Rewritten history starts a new segment; this is not a provider
cache-miss signal.
