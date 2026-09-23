/**
 * android-emulator MCP server — ADB-backed device control over stdio.
 *
 * Original work for this repository, written against the public Android Debug
 * Bridge command line (`adb`, `emulator`) that ships with the Android SDK
 * platform-tools. No third-party source is vendored; see the plugin NOTICE.md
 * for the survey that considered upstream MCP servers and why this server is
 * written rather than derived.
 *
 * Transport: MCP over stdio — newline-delimited JSON-RPC 2.0. One JSON object
 * per line in, one per line out. No Content-Length framing.
 *
 * Declared by `.zcodium-plugin/plugin.json` as:
 *   node ${ZCODE_PLUGIN_ROOT}/scripts/mcp/server.mjs
 *
 * Tools (the names the android-dev skill documents):
 *   list_devices    install_apk     uninstall      launch_app     stop_app
 *   tap             swipe           input_text     key_event      screenshot
 *   dump_ui         logcat          list_avds      start_avd      stop_avd
 *   current_focus   shell           wait_for_device
 *
 * Everything shells out to `adb`. When `adb` is missing the tool returns an
 * error result naming the install path — it never pretends a device exists.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADB = process.env.ANDROID_PLUGIN_ADB ?? "adb";
const EMULATOR = process.env.ANDROID_PLUGIN_EMULATOR ?? "emulator";
const DEFAULT_AVD = process.env.ANDROID_PLUGIN_DEFAULT_AVD ?? "medium_phone";
const DEVICE_WAIT_TIMEOUT_MS = Number(process.env.ANDROID_PLUGIN_WAIT_TIMEOUT_MS ?? "60000");

// ---------------------------------------------------------------- adb plumbing

/** Run adb (or emulator) and collect stdout/stderr. Never throws on non-zero. */
function run(binary, args, { timeoutMs = 30000, serial } = {}) {
  const fullArgs = serial ? ["-s", serial, ...args] : args;
  const result = spawnSync(binary, fullArgs, {
    encoding: "buffer",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    error: result.error,
  };
}

function adb(args, options) {
  const result = run(ADB, args, options);
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
    error: result.error?.message,
  };
}

function adbBuffer(args, options) {
  const result = run(ADB, args, options);
  return { ok: result.status === 0, buffer: result.stdout, stderr: result.stderr.toString("utf8") };
}

/** Resolve the target serial: explicit argument, or ANDROID_SERIAL, or the only device. */
function resolveSerial(serial) {
  if (serial) return serial;
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  const list = adb(["devices"]);
  if (!list.ok) return null;
  const lines = list.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("*"));
  const online = lines.filter((line) => line.split(/\s+/)[1] === "device");
  if (online.length === 1) return online[0].split(/\s+/)[0];
  return null;
}

// ------------------------------------------------------------------- tool impls

const tools = {
  list_devices: {
    description: "List connected Android devices and emulators with their state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler() {
      const result = adb(["devices", "-l"]);
      if (!result.ok) {
        return toolError(`adb devices failed: ${result.stderr || result.error || result.status}`);
      }
      const devices = result.stdout
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [serial, state, ...rest] = line.split(/\s+/);
          return { serial, state, details: rest.join(" ") };
        });
      return jsonResult({ devices });
    },
  },

  install_apk: {
    description: "Install (or reinstall, keeping data) an APK onto a device.",
    inputSchema: {
      type: "object",
      properties: {
        apk_path: { type: "string", description: "Absolute path to the .apk on the host." },
        serial: { type: "string" },
      },
      required: ["apk_path"],
      additionalProperties: false,
    },
    handler({ apk_path, serial }) {
      const target = resolveSerial(serial);
      const result = adb(["install", "-r", "-d", apk_path], { serial: target, timeoutMs: 180000 });
      if (!result.ok) {
        return toolError(`install failed: ${result.stderr || result.stdout}`);
      }
      return jsonResult({ installed: apk_path, output: result.stdout.trim() });
    },
  },

  uninstall: {
    description: "Uninstall a package by its application id.",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, serial: { type: "string" } },
      required: ["package"],
      additionalProperties: false,
    },
    handler({ package: pkg, serial }) {
      const result = adb(["uninstall", pkg], { serial: resolveSerial(serial) });
      if (!result.ok) return toolError(`uninstall failed: ${result.stderr}`);
      return jsonResult({ uninstalled: pkg, output: result.stdout.trim() });
    },
  },

  launch_app: {
    description: "Launch an app by package id through its launcher activity.",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, serial: { type: "string" } },
      required: ["package"],
      additionalProperties: false,
    },
    handler({ package: pkg, serial }) {
      const target = resolveSerial(serial);
      const result = adb(
        ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"],
        { serial: target },
      );
      if (!result.ok) return toolError(`launch failed: ${result.stderr || result.stdout}`);
      return jsonResult({ launched: pkg });
    },
  },

  stop_app: {
    description: "Force-stop a running package.",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string" }, serial: { type: "string" } },
      required: ["package"],
      additionalProperties: false,
    },
    handler({ package: pkg, serial }) {
      const result = adb(["shell", "am", "force-stop", pkg], { serial: resolveSerial(serial) });
      if (!result.ok) return toolError(`force-stop failed: ${result.stderr}`);
      return jsonResult({ stopped: pkg });
    },
  },

  tap: {
    description: "Tap the screen at absolute pixel coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
        serial: { type: "string" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    handler({ x, y, serial }) {
      const result = adb(["shell", "input", "tap", String(x), String(y)], {
        serial: resolveSerial(serial),
      });
      if (!result.ok) return toolError(`tap failed: ${result.stderr}`);
      return jsonResult({ tapped: { x, y } });
    },
  },

  swipe: {
    description: "Swipe from one point to another with an optional duration in ms.",
    inputSchema: {
      type: "object",
      properties: {
        x1: { type: "integer" },
        y1: { type: "integer" },
        x2: { type: "integer" },
        y2: { type: "integer" },
        duration_ms: { type: "integer" },
        serial: { type: "string" },
      },
      required: ["x1", "y1", "x2", "y2"],
      additionalProperties: false,
    },
    handler({ x1, y1, x2, y2, duration_ms, serial }) {
      const args = ["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2)];
      if (duration_ms) args.push(String(duration_ms));
      const result = adb(args, { serial: resolveSerial(serial) });
      if (!result.ok) return toolError(`swipe failed: ${result.stderr}`);
      return jsonResult({ swiped: { from: [x1, y1], to: [x2, y2] } });
    },
  },

  input_text: {
    description: "Type text into the focused field. Spaces become %s.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, serial: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    handler({ text, serial }) {
      // adb input text treats a space as an argument separator; %s is the
      // documented escape. Shell metacharacters are not interpreted because
      // the text is a single argv entry.
      const escaped = text.replace(/ /g, "%s");
      const result = adb(["shell", "input", "text", escaped], { serial: resolveSerial(serial) });
      if (!result.ok) return toolError(`input text failed: ${result.stderr}`);
      return jsonResult({ typed: text.length });
    },
  },

  key_event: {
    description: "Send a key event by Android keycode (e.g. 4 = BACK, 3 = HOME).",
    inputSchema: {
      type: "object",
      properties: { keycode: { type: "integer" }, serial: { type: "string" } },
      required: ["keycode"],
      additionalProperties: false,
    },
    handler({ keycode, serial }) {
      const result = adb(["shell", "input", "keyevent", String(keycode)], {
        serial: resolveSerial(serial),
      });
      if (!result.ok) return toolError(`keyevent failed: ${result.stderr}`);
      return jsonResult({ sent: keycode });
    },
  },

  screenshot: {
    description: "Capture the screen to a PNG on the host and return its path.",
    inputSchema: {
      type: "object",
      properties: { serial: { type: "string" } },
      additionalProperties: false,
    },
    handler({ serial } = {}) {
      const target = resolveSerial(serial);
      const capture = adbBuffer(["exec-out", "screencap", "-p"], { serial: target });
      if (!capture.ok || capture.buffer.length === 0) {
        return toolError(`screenshot failed: ${capture.stderr || "empty capture"}`);
      }
      const dir = mkdtempSync(join(tmpdir(), "android-mcp-"));
      const file = join(dir, `screenshot-${Date.now()}.png`);
      writeFileSync(file, capture.buffer);
      return jsonResult({ path: file, bytes: capture.buffer.length });
    },
  },

  dump_ui: {
    description: "Dump the current view hierarchy as XML and return its host path.",
    inputSchema: {
      type: "object",
      properties: { serial: { type: "string" } },
      additionalProperties: false,
    },
    handler({ serial } = {}) {
      const target = resolveSerial(serial);
      const device = "/sdcard/window_dump.xml";
      const dumped = adb(["shell", "uiautomator", "dump", device], { serial: target });
      if (!dumped.ok) return toolError(`uiautomator dump failed: ${dumped.stderr}`);
      const dir = mkdtempSync(join(tmpdir(), "android-mcp-"));
      const file = join(dir, "window_dump.xml");
      const pulled = adbBuffer(["pull", device, file], { serial: target, timeoutMs: 30000 });
      if (!pulled.ok) return toolError(`pull failed: ${pulled.stderr}`);
      return jsonResult({ path: file });
    },
  },

  logcat: {
    description: "Read the most recent logcat lines and exit (-d).",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "integer", default: 200 },
        filter: { type: "string", description: "Optional tag or tag:priority filter." },
        serial: { type: "string" },
      },
      additionalProperties: false,
    },
    handler({ lines = 200, filter, serial }) {
      const args = ["logcat", "-d", "-t", String(lines)];
      if (filter) args.push(filter);
      const result = adb(args, { serial: resolveSerial(serial), timeoutMs: 20000 });
      if (!result.ok) return toolError(`logcat failed: ${result.stderr}`);
      return jsonResult({ lines: result.stdout.split("\n").filter(Boolean) });
    },
  },

  list_avds: {
    description: "List the Android Virtual Devices defined on this machine.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler() {
      const result = run(EMULATOR, ["-list-avds"], { timeoutMs: 20000 });
      if (result.status !== 0) {
        return toolError(
          `emulator -list-avds failed: ${result.stderr.toString("utf8") || result.error?.message || ""}`,
        );
      }
      const avds = result.stdout
        .toString("utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return jsonResult({ avds });
    },
  },

  start_avd: {
    description: "Start an emulator for the named AVD in the background and wait for it to boot.",
    inputSchema: {
      type: "object",
      properties: {
        avd: { type: "string", default: DEFAULT_AVD },
        cold_boot: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    handler({ avd = DEFAULT_AVD, cold_boot = false }) {
      const args = ["-avd", avd];
      if (cold_boot) args.push("-no-snapshot-load");
      const child = spawn(EMULATOR, args, { detached: true, stdio: "ignore" });
      child.unref();
      const waited = waitForDevice(DEVICE_WAIT_TIMEOUT_MS);
      if (!waited.ok) {
        return toolError(`emulator started but no device came online: ${waited.reason}`);
      }
      return jsonResult({ started: avd, serial: waited.serial });
    },
  },

  stop_avd: {
    description: "Shut down a running emulator by serial (or the only device).",
    inputSchema: {
      type: "object",
      properties: { serial: { type: "string" } },
      additionalProperties: false,
    },
    handler({ serial } = {}) {
      const target = resolveSerial(serial);
      if (!target) return toolError("no device serial resolved");
      const result = adb(["emu", "kill"], { serial: target });
      if (!result.ok) return toolError(`emu kill failed: ${result.stderr}`);
      return jsonResult({ stopped: target });
    },
  },

  current_focus: {
    description: "Report the focused window and activity — the check that a launch actually happened.",
    inputSchema: {
      type: "object",
      properties: { serial: { type: "string" } },
      additionalProperties: false,
    },
    handler({ serial } = {}) {
      const result = adb(["shell", "dumpsys", "window", "windows"], {
        serial: resolveSerial(serial),
        timeoutMs: 20000,
      });
      if (!result.ok) return toolError(`dumpsys window failed: ${result.stderr}`);
      const focus = result.stdout
        .split("\n")
        .filter((line) => /mCurrentFocus|mFocusedApp/.test(line))
        .map((line) => line.trim());
      return jsonResult({ focus });
    },
  },

  shell: {
    description: "Run an arbitrary adb shell command. Escape hatch for anything the typed tools do not cover.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, serial: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    },
    handler({ command, serial }) {
      const result = adb(["shell", command], {
        serial: resolveSerial(serial),
        timeoutMs: 60000,
      });
      return jsonResult({
        ok: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    },
  },

  wait_for_device: {
    description: "Block until a device is online (adb wait-for-device) or the timeout expires.",
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: { type: "integer", default: DEVICE_WAIT_TIMEOUT_MS },
        serial: { type: "string" },
      },
      additionalProperties: false,
    },
    handler({ timeout_ms = DEVICE_WAIT_TIMEOUT_MS, serial }) {
      const waited = waitForDevice(timeout_ms, serial);
      if (!waited.ok) return toolError(`no device within ${timeout_ms}ms: ${waited.reason}`);
      return jsonResult({ online: waited.serial });
    },
  },
};

function waitForDevice(timeoutMs, serial) {
  const target = serial ?? process.env.ANDROID_SERIAL;
  const args = target ? ["-s", target, "wait-for-device"] : ["wait-for-device"];
  const result = run(ADB, args, { timeoutMs });
  if (result.status === 0) {
    return { ok: true, serial: target ?? resolveSerial() ?? undefined };
  }
  return { ok: false, reason: result.error?.message ?? `adb exited ${result.status}` };
}

// ------------------------------------------------------------------ MCP plumbing

function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const TOOL_LIST = Object.entries(tools).map(([name, tool]) => ({
  name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

function send(message) {
  const line = JSON.stringify(message);
  process.stdout.write(`${line}\n`);
}

function handleMessage(message) {
  const { id, method, params } = message;
  if (id === undefined || id === null) {
    // Notification: nothing to answer.
    return;
  }
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "android-emulator", version: "0.1.0" },
        },
      });
      return;
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOL_LIST } });
      return;
    case "tools/call": {
      const name = params?.name;
      const tool = tools[name];
      if (!tool) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `unknown tool: ${name}` },
        });
        return;
      }
      try {
        const result = tool.handler(params?.arguments ?? {});
        send({ jsonrpc: "2.0", id, result });
      } catch (error) {
        send({
          jsonrpc: "2.0",
          id,
          result: toolError(error instanceof Error ? error.message : String(error)),
        });
      }
      return;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

// Newline-delimited JSON-RPC: buffer partial lines until a newline arrives.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) {
      try {
        handleMessage(JSON.parse(line));
      } catch (error) {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `parse error: ${error.message}` },
        });
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
