import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const {
  createCommandCenter,
  formatSlashCommandHelp,
  listSlashCommandSuggestions,
  formatCliHelp,
  run,
  runPrompt,
  createTuiSubmitPrompt,
} = await tsImport("./fixtures/cli-self-managed-commands.ts", import.meta.url);

test("busy TUI input rejects retired account commands before app or queue admission", async () => {
  const deps = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "shutdownCleanupTimeoutMs") return undefined;
        throw new Error(`Unexpected app dependency: ${String(key)}`);
      },
    },
  );
  for (const locale of ["en-US", "zh-CN"]) {
    const handler = createTuiSubmitPrompt(deps, {}, "fixture", undefined, locale);
    try {
      for (const text of ["/LOGIN fixture-private-key", "/logout fixture-private-key"]) {
        const result = await handler.sendInput(
          { text, attachments: [] },
          {
            expectedTurnId: "fixture-active-turn",
            delivery: "auto",
          },
        );
        assert.equal(result.kind, "command_result");
        assert.match(result.result.response, locale === "zh-CN" ? /已移除/ : /removed/);
        assert.ok(!result.result.response.includes("fixture-private-key"));
      }
    } finally {
      await handler.close();
    }
  }
});

test("retired account commands cannot consume secrets, write history or invoke custom/model commands", async () => {
  const calls = [];
  const forbidden = (name) => async () => {
    calls.push(name);
    return {};
  };
  const submit = createCommandCenter({
    getApp: forbidden("app"),
    resumeApp: forbidden("resume"),
    login: forbidden("login"),
    loginBigmodel: forbidden("bigmodel"),
    configureApiKey: forbidden("key"),
    logout: forbidden("logout"),
    recordInputHistory: forbidden("history"),
    loadCustomCommand: forbidden("custom"),
  });
  for (const command of [
    "/login",
    "/logout",
    "/LOGIN zai-coding-plan-api-key fixture-private-key",
    "/login bigmodel-coding-plan-api-key fixture-private-key",
  ]) {
    const result = await submit(command, {});
    assert.match(result.response, /removed/i);
    assert.ok(!result.response.includes("fixture-private-key"));
    assert.equal(result.selection, undefined);
  }
  assert.deepEqual(calls, []);
});

test("model setup guidance replaces account login and submitting recovers when models become available", async () => {
  let ready = false;
  const prompts = [];
  const submit = createCommandCenter({
    hasSelectableModels: () => ready,
    getApp: async () => ({
      submitPrompt: async (input) => {
        prompts.push(input);
        return { response: "fixture response" };
      },
    }),
  });
  const missing = await submit("fixture question", {});
  assert.equal(missing.modelSetupRequired, true);
  assert.match(missing.response, /provider_config\.json/);
  assert.ok(!missing.response.includes("/login"));
  assert.equal(prompts.length, 0);
  ready = true;
  const answer = await submit("fixture question", {});
  assert.equal(answer.response, "fixture response");
  assert.equal(answer.modelSetupRequired, false);
  assert.deepEqual(prompts, ["fixture question"]);
});

test("CLI and slash help offer self-managed commands without official sign-in choices", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    assert.doesNotMatch(formatCliHelp("fixture", locale), /\/login|\/logout|no-browser|login \[/);
  }
  assert.doesNotMatch(formatSlashCommandHelp(""), /\/login|\/logout/);
  assert.ok(
    listSlashCommandSuggestions().every((item) => !["login", "logout"].includes(item.name)),
  );
});

test("CLI and headless login commands return a fixed failure without account IO or echoing parameters", async () => {
  const deps = new Proxy(
    {},
    {
      get(_, key) {
        throw new Error(`Unexpected dependency access: ${String(key)}`);
      },
    },
  );
  for (const locale of ["en-US", "zh-CN"]) {
    for (const command of ["login", "logout"]) {
      let output = "";
      const stream = {
        write: (text) => {
          output += text;
        },
      };
      const ctx = {
        argv: ["--locale", locale, command, "fixture-private-key"],
        stdout: stream,
        stderr: stream,
      };
      assert.equal(await run(ctx, deps), 1);
      assert.match(output, locale === "zh-CN" ? /已移除/ : /removed/);
      assert.ok(!output.includes("fixture-private-key"));
      output = "";
      assert.equal(
        await runPrompt(ctx, `/${command} fixture-private-key`, [], { locale }, deps, "fixture"),
        1,
      );
      assert.match(output, locale === "zh-CN" ? /已移除/ : /removed/);
      assert.ok(!output.includes("fixture-private-key"));
    }
  }
});
