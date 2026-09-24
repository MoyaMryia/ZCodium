import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { tsImport } from "tsx/esm/api";
const directory = await mkdtemp(join(tmpdir(), "zcodium-built-scheduler-"));
const { setDataBaseDir, getTasksIndexDatabasePath } = await tsImport(
  "../../packages/services/src/paths.ts",
  import.meta.url,
);
const { AutomationRepo } = await tsImport(
  "../../packages/services/src/session/automationRepo.ts",
  import.meta.url,
);
setDataBaseDir(directory);
const path = getTasksIndexDatabasePath();
assert.ok(path.startsWith(directory));
const repo = new AutomationRepo(path);
let db, child, closed;
const errors = [],
  messages = [];
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(!child || child.exitCode === null, `Scheduler exited: ${errors.join("")}`);
    assert.ok(Date.now() < deadline, `${label}: ${errors.join("")}`);
    await delay(20);
  }
}
try {
  const input = {
    title: "Fixture scheduled task",
    prompt: "Fixture instructions",
    cronExpr: "0 9 * * *",
    mode: "build",
    recurring: true,
    workspacePath: "/fixture/project",
    workspaceIdentity: "fixture-identity",
    modelSelection: { providerId: "fixture-api", modelId: "fixture-model" },
  };
  const first = await repo.create(input, { nextRunAt: Date.now() - 500 });
  const pending = await repo.create(input, { nextRunAt: Date.now() - 500 });
  db = new DatabaseSync(path);
  db.prepare(
    "INSERT INTO off_peak_tasks (off_peak_task_id, prompt, permission_mode, workspace_key, workspace_path, status, queued_at, schedulable, server_ticket_id, created_at, updated_at) VALUES ('offpeak-old', 'Historical instructions', 'build', '/fixture', '/fixture', 'queued', 1, 1, 'old-ticket', 1, 1)",
  ).run();
  const history = db.prepare("SELECT * FROM off_peak_tasks").all();
  child = fork(
    resolve(import.meta.dirname, "fixtures/scheduler-process.mjs"),
    [resolve(import.meta.dirname, "../../packages/desktop/out/scheduler/index.js")],
    {
      cwd: directory,
      execArgv: [],
      env: {
        ...process.env,
        ZCODE_DATA_BASE_DIR: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  closed = once(child, "close");
  child.stderr.on("data", (data) => errors.push(String(data)));
  child.on("message", (message) => messages.push(message));
  await until(
    () => messages.filter((m) => m.type === "cron-dispatch-request").length === 2,
    "Scheduled dispatch",
  );
  const dispatches = messages.filter((m) => m.type === "cron-dispatch-request");
  assert.deepEqual(
    dispatches.map((m) => m.automationId).sort(),
    [first.automationId, pending.automationId].sort(),
  );
  assert.ok(
    dispatches.every(
      (m) =>
        m.workspaceIdentity === input.workspaceIdentity &&
        m.modelSelection.providerId === "fixture-api",
    ),
  );
  const accepted = dispatches.find((m) => m.automationId === first.automationId);
  child.send({
    type: "cron-dispatch-result",
    runId: accepted.runId,
    ok: true,
    sessionId: "fixture-session",
  });
  await until(
    () =>
      db.prepare("SELECT dispatch_status FROM automation_runs WHERE run_id=?").get(accepted.runId)
        ?.dispatch_status === "dispatched",
    "Scheduled result settlement",
  );
  child.send({ type: "scheduler-dispose" });
  const [code] = await closed;
  assert.equal(code, 0, errors.join(""));
  assert.equal(
    db.prepare("SELECT running FROM automations WHERE automation_id=?").get(pending.automationId)
      .running,
    0,
  );
  assert.deepEqual(db.prepare("SELECT * FROM off_peak_tasks").all(), history);
  assert.equal(
    messages.some((m) => m.type.startsWith("offpeak")),
    false,
  );
  console.log(
    "Built scheduler: real SQLite dispatch/identity/settlement/shutdown passed; historical idle queue untouched.",
  );
} finally {
  if (child && child.exitCode === null) child.kill();
  if (closed) await closed;
  db?.close();
  repo.close();
  setDataBaseDir(null);
  await rm(directory, { recursive: true, force: true });
}
