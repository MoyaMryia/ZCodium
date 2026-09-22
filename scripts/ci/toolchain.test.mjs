import assert from "node:assert/strict";
import test from "node:test";
import { parseToolchain } from "./toolchain.mjs";

test("read pinned versions from the tools table, not TOML's first line", () => {
  assert.deepEqual(
    parseToolchain(
      '[tools]\r\nnode = "24.14.0"\r\npnpm = "10.33.2"\r\n[env]\r\nnode = "wrong"',
      "pnpm@10.33.2",
    ),
    { node: "24.14.0", pnpm: "10.33.2" },
  );
});

test("reject missing, floating and conflicting toolchain declarations", () => {
  for (const source of [
    '[env]\nnode = "24.14.0"\npnpm = "10.33.2"',
    '[tools]\nnode = "24"\npnpm = "10.33.2"',
    '[tools]\nnode = "24.14.0"\npnpm = "10.32.0"',
  ])
    assert.throws(() => parseToolchain(source, "pnpm@10.33.2"));
});
