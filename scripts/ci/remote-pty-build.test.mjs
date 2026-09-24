import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { tsImport } from "tsx/esm/api";
import { createRemotePtyBuildPlugin } from "../remote-pty-build.mjs";
const { validateRemoteServerBundle } = await tsImport(
  "../../packages/server/buildRemoteValidation.ts",
  import.meta.url,
);

test("remote build inlines the JS wrapper matching the dedicated native PTY package", async () => {
  const result = await build({
    stdin: { contents: 'export { spawn } from "node-pty";', resolveDir: process.cwd() },
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "cjs",
    plugins: [createRemotePtyBuildPlugin()],
  });
  const bundledInputs = Object.keys(result.metafile.inputs);
  assert.ok(
    bundledInputs.some((path) => path.includes("@lydell/node-pty-linux-x64/lib/unixTerminal.js")),
  );
  validateRemoteServerBundle({ bundledInputs, source: result.outputFiles[0].text });
});

test("remote validation rejects a mixed node-pty wrapper and unresolved runtime imports", () => {
  assert.throws(
    () =>
      validateRemoteServerBundle({
        bundledInputs: ["node_modules/node-pty/lib/unixTerminal.js"],
        source: "",
      }),
    /dedicated/,
  );
  assert.throws(
    () => validateRemoteServerBundle({ bundledInputs: [], source: 'require("undici")' }),
    /inline undici/,
  );
});
