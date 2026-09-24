import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tsImport } from "tsx/esm/api";

const { createOnboardingRecordService, getDataBaseDir, setDataBaseDir, getAppConfigDir } =
  await tsImport("./fixtures/local-onboarding.ts", import.meta.url);
const entry = {
  occupation: "writer",
  interfaceMode: "office",
  memoryEnabled: false,
  proactiveSuggestionsEnabled: true,
  completedAt: "2026-09-24T12:00:00Z",
};

test("local onboarding retains latest preferences and removes account attribution from reads and writes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zcodium-onboarding-"));
  const previous = getDataBaseDir();
  setDataBaseDir(dir);
  t.after(async () => {
    setDataBaseDir(previous);
    await rm(dir, { recursive: true, force: true });
  });
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Official IO forbidden");
  });
  const service = createOnboardingRecordService(
    new Proxy(
      {},
      {
        get() {
          throw new Error("User identity must not be loaded");
        },
      },
    ),
  );
  const file = join(getAppConfigDir(), "onboarding-record.json");
  await mkdir(getAppConfigDir(), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      deviceMid: "fixture-device",
      entries: [
        { ...entry, userId: "fixture-account", uploadState: "pending" },
        { ...entry, occupation: "developer", completedAt: "2026-09-22T12:00:00Z", userId: null },
      ],
    }),
  );
  assert.deepEqual(await service.getLatestEntry(), entry);
  assert.doesNotMatch(
    JSON.stringify(await service.getRecords()),
    /userId|fixture-account|deviceMid|uploadState/,
  );
  assert.equal(service.claimAnonymousRecord, undefined);
  assert.equal(service.syncSettingsFromRecord, undefined);
  const accepted = service.appendRecord({ ...entry, userId: "ignored-input", memoryEnabled: true });
  const update = service.updateRecordPreferences({ proactiveSuggestionsEnabled: false });
  // Read after accepted writes must wait for the same owner queue.
  assert.deepEqual(await service.getLatestEntry(), {
    ...entry,
    memoryEnabled: true,
    proactiveSuggestionsEnabled: false,
  });
  await Promise.all([accepted, update]);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted, {
    version: 1,
    entries: [{ ...entry, memoryEnabled: true, proactiveSuggestionsEnabled: false }],
  });
  assert.deepEqual(await createOnboardingRecordService().getLatestEntry(), persisted.entries[0]);
  await service.clearRecords();
  assert.equal(await service.getLatestEntry(), null);
  await writeFile(file, "broken fixture json");
  assert.equal(await service.getRecords(), null);
  await service.appendRecord(entry);
  assert.deepEqual(await service.getLatestEntry(), entry);
  assert.equal(fetch.mock.callCount(), 0);
});
