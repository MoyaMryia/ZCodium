import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const file = resolve(import.meta.dirname, "cua-actions-smoke.mjs");
const host = join(root, "apps/zcode-cli/packages/node-repl-host/dist/mcp/server.js");
const plugin = join(root, "apps/zcode-cli/packages/zcode-cua-plugin");

async function session() {
  let browser, client;
  try {
    // 临时 HOME 没有用户辅助功能设置；显式启用本次私有总线上的 AT-SPI。
    for (const property of ["IsEnabled", "ScreenReaderEnabled"]) {
      await run("gdbus", [
        "call",
        "--session",
        "--dest",
        "org.a11y.Bus",
        "--object-path",
        "/org/a11y/bus",
        "--method",
        "org.freedesktop.DBus.Properties.Set",
        "org.a11y.Status",
        property,
        "<true>",
      ]);
    }
    browser = await chromium.launch({
      headless: false,
      executablePath: process.env.ZCODE_TEST_CHROMIUM_EXECUTABLE,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--force-renderer-accessibility",
        "--window-size=1100,760",
        "--window-position=80,70",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(`<!doctype html><title>ZCodium CUA Fixture</title>
      <style>body{font:24px sans-serif;padding:40px}input,button{font:24px sans-serif;padding:12px;margin:16px}</style>
      <h1>Computer Use Test</h1><label>Message<input id="value" aria-label="Message"></label>
      <button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#value').value">Save</button>
      <p id="result">Waiting</p>
      <button onmousedown="window.dragStarted=true">Drag source</button>
      <button onmouseup="if(window.dragStarted) document.querySelector('#result').textContent='drag-ok'">Drop target</button>
      <script>window.inputEvents=[]; for(const type of ['mousedown','mouseup']) document.addEventListener(type,e=>window.inputEvents.push({type,x:e.clientX,y:e.clientY,target:e.target.textContent}));</script>`);
    await page.bringToFront();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [host],
      cwd: process.env.HOME,
      stderr: "pipe",
      env: {
        ...process.env,
        ZCODE_CUA_PLUGIN_ROOT: plugin,
        ZCODE_CUA_DRIVER_EMBEDDED: "1",
        ZCODE_CUA_DRIVER_SOCKET: "",
      },
    });
    client = new Client(
      { name: "cua-actions-fixture", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(transport);
    const bootstrap = `
      const sdk = await import(${JSON.stringify(pathToFileURL(join(plugin, "scripts/computer-use-client.mjs")).href)});
      await sdk.setupComputerUseRuntime({globals:globalThis});
      const cua = agent.computerUse;
    `;
    async function cell(code) {
      const result = await client.callTool({
        name: "js",
        arguments: { code: bootstrap + code, title: "验证测试窗口", timeout_ms: 20000 },
        _meta: {
          "com.zcode/request-context": {
            session_id: "cua-fixture",
            runtime_scope: "main",
            workspace_path: process.env.HOME,
            workspace_key: "cua-fixture",
          },
        },
      });
      assert.ok(!result.isError, JSON.stringify(result));
      return result;
    }
    let window;
    for (let attempt = 0; attempt < 50 && !window; attempt++) {
      const result = await cell(
        "nodeRepl.write(JSON.stringify(await cua.computer.list_windows({})));",
      );
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const match = text.match(/\[\{[^\n]*\}\]/);
      if (match)
        window = JSON.parse(match[0]).find((item) => item.title?.includes("ZCodium CUA Fixture"));
      if (!window) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(window, "Fixture window must be registered by the window manager");
    const bind = `const app = await cua.getWindow({pid:${window.pid}},${window.window_id});`;
    // Ubuntu 24 的 AT-SPI 使用 push button，新版本使用 button；两者都是同一控件角色。
    const observe = `
      const tree = await app.getAXState({emit:false});
      const field = /\\[(\\d+)\\] entry "Message"/.exec(tree);
      const save = /\\[(\\d+)\\] (?:push )?button "Save"/.exec(tree);
      if(!field || !save) throw new Error("Fixture accessibility controls missing: " + tree);
    `;
    await cell(bind + observe);
    const shot = await cell(bind + "await app.getScreenshot();");
    assert.ok(
      shot.content.some((block) => block.type === "image"),
      "Real driver screenshot must reach the MCP response",
    );
    assert.ok(
      shot.structuredContent.window.bounds.x > 0 && shot.structuredContent.window.bounds.y > 0,
      "Fixture must exercise a window away from the screen origin",
    );
    await cell(
      bind + observe + 'await app.click(Number(field[1])); await app.typeText("offline-input-ok");',
    );
    await page.waitForFunction(() => document.querySelector("#value").value === "offline-input-ok");
    await cell(bind + observe + "await app.click(Number(save[1]));");
    await page.waitForFunction(
      () => document.querySelector("#result").textContent === "offline-input-ok",
    );
    // A fresh Worker re-binds without relying on the previous cell's JavaScript globals.
    await cell(
      bind +
        observe +
        'await app.click(Number(field[1])); await app.pressKey("CTRL+A"); await app.typeText("second-cell-ok"); await app.click(Number(save[1]));',
    );
    await page.waitForFunction(
      () => document.querySelector("#result").textContent === "second-cell-ok",
    );
    await cell(
      bind +
        `
      const {state} = await app.getAXStateAndScreenshot({emit:false});
      const source = /\\[(\\d+)\\] (?:push )?button "Drag source"/.exec(state);
      const destination = /\\[(\\d+)\\] (?:push )?button "Drop target"/.exec(state);
      if(!source || !destination) throw new Error("Drag fixture controls missing");
      await app.drag(Number(source[1]),Number(destination[1]),{deliveryMode:"foreground"});
    `,
    );
    await page.waitForFunction(() => document.querySelector("#result").textContent === "drag-ok");
    assert.deepEqual(
      await page.evaluate(() =>
        window.inputEvents.slice(-2).map(({ type, target }) => ({ type, target })),
      ),
      [
        { type: "mousedown", target: "Drag source" },
        { type: "mouseup", target: "Drop target" },
      ],
    );
    console.log(
      "CUA screenshot, element click, text input, keyboard replacement, drag and re-observation passed through MCP/Worker/native driver.",
    );
  } finally {
    await client?.close();
    await browser?.close();
  }
}

async function desktop() {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-cua-actions-"));
  let display, wm;
  try {
    await mkdir(join(directory, "run"), { mode: 0o700 });
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_CACHE_HOME: join(directory, "cache"),
      XDG_DATA_HOME: join(directory, "data"),
      XDG_RUNTIME_DIR: join(directory, "run"),
      XDG_CONFIG_DIRS: process.env.XDG_CONFIG_DIRS || "/etc/xdg",
      XDG_DATA_DIRS: process.env.XDG_DATA_DIRS || "/usr/share",
      XDG_SESSION_TYPE: "x11",
      LANG: "C.UTF-8",
      LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || "",
      ZCODE_TEST_CHROMIUM_EXECUTABLE:
        process.env.ZCODE_TEST_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    };
    display = spawn(
      process.argv[3] || "Xvfb",
      ["-displayfd", "3", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
      { env, stdio: ["ignore", "ignore", "ignore", "pipe"] },
    );
    const displayNumber = await Promise.race([
      once(display.stdio[3], "data").then(([bytes]) => bytes.toString().trim()),
      once(display, "exit").then(() => {
        throw new Error("Xvfb exited before becoming ready");
      }),
    ]);
    env.DISPLAY = `:${displayNumber}`;
    wm = spawn(process.argv[4] || "openbox", ["--sm-disable"], { env, stdio: "ignore" });
    const bus = spawn("dbus-run-session", ["--", process.execPath, file, "--session"], {
      env,
      cwd: root,
      stdio: "inherit",
    });
    const deadline = setTimeout(() => bus.kill("SIGKILL"), 90000);
    try {
      const [status] = await once(bus, "exit");
      assert.equal(status, 0, "CUA session failed");
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    for (const child of [wm, display]) {
      if (child && child.exitCode === null) {
        const closed = once(child, "exit");
        child.kill();
        await closed;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function isolated() {
  assert.equal(process.platform, "linux", "X11 action smoke requires Linux");
  const args = [
    "--die-with-parent",
    "--unshare-net",
    "--unshare-pid",
    "--ro-bind",
    "/",
    "/",
    "--bind",
    "/tmp",
    "/tmp",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  const query = "/sys/kernel/security/apparmor/.access";
  const available = await stat(query).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  // DBus 查询 AppArmor 需要向此虚拟接口写入查询；只读挂载会被误判为无障碍服务不可用。
  // 不修改 AppArmor 策略，也不开放其他系统路径写入。
  if (available) args.push("--bind", query, query);
  args.push("--", process.execPath, file, "--display", ...process.argv.slice(2));
  const child = spawn("bwrap", args, { stdio: "inherit" });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 150000);
  try {
    const [status] = await once(child, "exit");
    assert.equal(status, 0, "Isolated CUA actions failed");
  } finally {
    clearTimeout(deadline);
  }
}

if (process.argv[2] === "--session") await session();
else if (process.argv[2] === "--display") await desktop();
else await isolated();
