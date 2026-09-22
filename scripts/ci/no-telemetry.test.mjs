import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const excluded = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "native",
  ".git",
  "out",
  ".turbo",
]);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !excluded.has(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
  );
  return nested.flat();
}

test("application dependencies contain no telemetry SDK or workspace package", async () => {
  const paths = [
    join(root, "package.json"),
    ...(await files(join(root, "packages"))),
    ...(await files(join(root, "apps/zcode-cli"))),
  ];
  const found = [];
  for (const path of paths.filter((path) => basename(path) === "package.json")) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    })) {
      if (/^@(?:opentelemetry\/|arms\/)|^@zcode\/telemetry$/.test(name))
        found.push(`${path.slice(root.length)}: ${name}`);
    }
  }
  assert.deepEqual(found, []);
});

test("product code cannot enable official or proprietary telemetry collectors", async () => {
  const paths = [
    ...(await files(join(root, "packages"))),
    ...(await files(join(root, "apps/zcode-cli/packages"))),
    ...(await files(join(root, "scripts"))),
  ];
  const forbidden =
    /(?:from\s+["']@arms\/|ZCODE_TELEMETRY_REPORT_ENDPOINT|ZCODE_ARMS_RUM_ENDPOINT|createTelemetryCore|getReportContext|reportTelemetryEvent|reportArmsCustomEvent)/;
  const found = [];
  for (const path of paths.filter(
    (path) => /\.(?:tsx?|mjs)$/.test(path) && !/\.d\.ts$|\.test\./.test(path),
  )) {
    if (forbidden.test(await readFile(path, "utf8"))) found.push(path.slice(root.length));
  }
  assert.deepEqual(found, []);
});
