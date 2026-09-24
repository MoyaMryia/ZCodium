import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { createQuickPickCommands } = await tsImport(
  "../../packages/ui/src/quickpick/quickPickCommands.ts",
  import.meta.url,
);

test("command palette keeps local settings and workspace actions without official account commands", async () => {
  const calls = [];
  const handlers = new Proxy(
    {},
    {
      get(_target, name) {
        assert.ok(
          name !== "login" && name !== "logout",
          "must not even access official account handlers",
        );
        return () => calls.push(name);
      },
    },
  );
  const commands = createQuickPickCommands({
    allowOpenWorkspace: true,
    canOpenCommunity: true,
    isSidebarVisible: true,
    themeTarget: "light",
    shortcuts: { newTask: "", openWorkspace: "", toggleSidebar: "", toggleTerminal: "" },
    handlers,
  });
  assert.ok(!commands.some((command) => /login|logout/.test(command.id)));
  for (const id of ["new-task", "open-workspace", "settings", "skills-settings", "mcp-settings"]) {
    const command = commands.find((command) => command.id === id);
    assert.ok(command, `${id} remains available`);
    await command.run();
  }
  assert.deepEqual(calls, [
    "createTask",
    "openWorkspace",
    "openSettings",
    "openSkillsSettings",
    "openMcpSettings",
  ]);
});
