import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { tsImport } from "tsx/esm/api";
import { reply } from "./fixtures/mcp-echo.mjs";

const { createMcpAdapter, resolvePluginMcpServers } = await tsImport(
  "./fixtures/mcp-self-managed.ts",
  import.meta.url,
);
const fixture = resolve(import.meta.dirname, "fixtures/mcp-echo.mjs");
const retired = {
  auth: { type: "zcode_official", provider: "jwt_token" },
  official: { pluginId: "fixture", mcpKey: "echo", source: "plugin" },
};

async function httpFixture(t) {
  const requests = [];
  const waiting = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    requests.push({ headers: req.headers, message });
    if (message.method === "tools/call" && message.params.arguments?.wait) {
      waiting.resolve();
      return;
    }
    const result = reply(message);
    if (!result) {
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const adapter = createMcpAdapter();
  t.after(async () => {
    await adapter.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  const config = {
    type: "http",
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    headers: { Authorization: "Bearer fixture-user-token" },
    timeoutMs: 3000,
  };
  return { adapter, config, requests, waiting };
}

test(
  "retired auth is rejected before HTTP or stdio connection while other MCP servers work",
  { timeout: 15000 },
  async (t) => {
    const f = await httpFixture(t);
    for (const config of [
      { ...f.config, ...retired },
      { type: "stdio", command: process.execPath, args: [fixture], ...retired },
    ]) {
      const status = await f.adapter.connectServer("retired", config);
      assert.equal(status.status, "failed");
      assert.match(status.error, /Unsupported MCP auth/);
    }
    assert.equal(f.requests.length, 0);
    assert.equal((await f.adapter.connectServer("echo", f.config)).status, "connected");
  },
);

test(
  "self-managed HTTP preserves static auth, tool errors, cancellation and reconnect",
  { timeout: 15000 },
  async (t) => {
    const f = await httpFixture(t);
    assert.equal((await f.adapter.connectServer("echo", f.config)).status, "connected");
    const call = (args, options) =>
      f.adapter.callTool({ serverName: "echo", toolName: "echo", arguments: args }, options);
    const result = await call({ value: "fixture" });
    assert.equal(JSON.parse(result.content[0].text).arguments.value, "fixture");
    assert.equal((await call({ fail: true })).isError, true);
    const controller = new AbortController();
    const pending = call({ wait: true }, { signal: controller.signal }).then(
      () => null,
      (error) => error,
    );
    await f.waiting.promise;
    controller.abort();
    assert.ok((await pending) instanceof Error);
    assert.equal((await call({ retry: true })).isError, undefined);
    await f.adapter.disconnectServer("echo");
    assert.equal((await f.adapter.connectServer("echo", f.config)).status, "connected");
    assert.equal(await f.adapter.pingServer("echo"), true);
    for (const request of f.requests) {
      assert.equal(request.headers.authorization, "Bearer fixture-user-token");
      assert.ok(!Object.keys(request.headers).some((name) => /bigmodel|coding-plan/i.test(name)));
      assert.ok(!request.message.params?._meta?.["com.zcode/official-mcp-auth"]);
    }
  },
);

test(
  "stdio keeps user env and ordinary tool metadata without official identity injection",
  { timeout: 15000 },
  async (t) => {
    const adapter = createMcpAdapter();
    t.after(() => adapter.close());
    const status = await adapter.connectServer("stdio", {
      type: "stdio",
      command: process.execPath,
      args: [fixture],
      env: { ZCODE_FIXTURE_MCP_VALUE: "user-configured" },
      timeoutMs: 3000,
    });
    assert.equal(status.status, "connected", status.error);
    const result = await adapter.callTool({
      serverName: "stdio",
      toolName: "echo",
      arguments: { value: "stdio" },
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.configuredEnv, "user-configured");
    assert.equal(payload.arguments.value, "stdio");
    assert.ok(!payload.meta["com.zcode/official-mcp-auth"]);
  },
);

function parse(definition) {
  const diagnostics = [];
  const servers = resolvePluginMcpServers({
    dataPath: "/fixture/data",
    workingDirectory: "/fixture/project",
    env: {},
    options: {},
    loaded: {
      id: "fixture@local",
      rootPath: "/fixture/plugin",
      manifestPath: "/fixture/plugin/manifest.json",
      manifest: { name: "fixture" },
    },
    definitions: { echo: definition },
    diagnostics,
  });
  return { servers, diagnostics };
}

test("plugin parser rejects retired auth and preserves ordinary OAuth and manual headers", () => {
  for (const type of ["http", "sse", "stdio"]) {
    const parsed = parse({
      type,
      url: "https://mcp.example.invalid",
      command: "fixture",
      ...retired,
    });
    assert.deepEqual(parsed.servers, {});
    assert.match(parsed.diagnostics[0].message, /Unsupported MCP auth/);
  }
  const config = {
    type: "http",
    url: "https://mcp.example.invalid",
    oauth: { type: "authorization_code" },
    headers: { "X-Fixture": "user-value", "X-Empty": "" },
  };
  const parsed = parse(config);
  assert.equal(parsed.diagnostics.length, 0);
  assert.deepEqual(parsed.servers["plugin:fixture:echo"].oauth, config.oauth);
  assert.deepEqual(parsed.servers["plugin:fixture:echo"].headers, config.headers);
  const stdio = parse({ type: "stdio", command: "fixture", env: { EMPTY: "" } });
  assert.equal(stdio.servers["plugin:fixture:echo"].env.EMPTY, "");
});

test(
  "image search is silent until configured and connects to the exact user MCP URL",
  { timeout: 15000 },
  async (t) => {
    const { readFile } = await import("node:fs/promises");
    const root = resolve(import.meta.dirname, "../../apps/zcode-cli/packages/image-search-plugin");
    const manifest = JSON.parse(
      await readFile(resolve(root, ".zcodium-plugin/plugin.json"), "utf8"),
    );
    const mcpFile = JSON.parse(await readFile(resolve(root, ".mcp.json"), "utf8"));
    assert.deepEqual(mcpFile.mcpServers, manifest.mcpServers);
    const f = await httpFixture(t);
    function plugin(options) {
      const diagnostics = [];
      const servers = resolvePluginMcpServers({
        dataPath: "/fixture/data",
        workingDirectory: "/fixture/project",
        env: {},
        options,
        loaded: {
          id: "image-search@zcode-plugins-official",
          rootPath: root,
          manifestPath: resolve(root, ".zcodium-plugin/plugin.json"),
          manifest,
        },
        definitions: manifest.mcpServers,
        diagnostics,
      });
      return { servers, diagnostics };
    }
    for (const options of [{}, { imageSearchMcpUrl: "  " }]) {
      const result = plugin(options);
      assert.deepEqual(result.servers, {});
      assert.equal(result.diagnostics[0].code, "plugin_variable_missing");
    }
    assert.equal(f.requests.length, 0);
    const anonymous = plugin({ imageSearchMcpUrl: f.config.url });
    assert.equal(anonymous.diagnostics.length, 0);
    const name = "plugin:image-search:image_search";
    assert.deepEqual(anonymous.servers[name].headers, {});
    assert.equal(anonymous.servers[name].url, f.config.url);
    const configured = plugin({
      imageSearchMcpUrl: f.config.url,
      authorizationHeader: "Bearer fixture-user-token",
    });
    assert.equal(configured.diagnostics.length, 0);
    assert.equal(configured.servers[name].headers.Authorization, "Bearer fixture-user-token");
    assert.equal(
      (await f.adapter.connectServer(name, configured.servers[name])).status,
      "connected",
    );
    const result = await f.adapter.callTool({
      serverName: name,
      toolName: "echo",
      arguments: { query: "fixture image search" },
    });
    assert.equal(JSON.parse(result.content[0].text).arguments.query, "fixture image search");
    assert.equal(manifest.userConfig.authorizationHeader.sensitive, true);
    assert.ok(!("auth" in configured.servers[name]));
  },
);
