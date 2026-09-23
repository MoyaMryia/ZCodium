/**
 * ios-simulator MCP server — simctl-backed simulator control over stdio.
 *
 * Original work for this repository, written against the public `xcrun simctl`
 * command line that ships with Xcode. No third-party source is vendored; see
 * the plugin NOTICE.md and the survey that considered upstream MCP servers.
 *
 * Transport: MCP over stdio — newline-delimited JSON-RPC 2.0.
 *
 * Declared by `.zcodium-plugin/plugin.json` as:
 *   node ${ZCODE_PLUGIN_ROOT}/scripts/mcp/server.mjs
 *
 * Tools (the names the ios-dev skill documents):
 *   list_devices   list_runtimes   boot          shutdown      erase
 *   create_device  install_app     uninstall_app launch_app    terminate_app
 *   screenshot     open_url        get_container set_appearance spawn
 *
 * Platform: macOS only. simctl is part of Xcode; every tool reports a clear
 * error when xcrun is missing rather than pretending the simulator exists.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SIMCTL = process.env.IOS_SIM_CTL ?? "simctl";
const DEFAULT_DEVICE = process.env.IOS_SIM_DEFAULT_DEVICE ?? "iPhone 16";

// --------------------------------------------------------------- simctl plumbing

function xcrun(args, { timeoutMs = 60000, allowStdout = true } = {}) {
  const result = spawnSync("xcrun", [SIMCTL, ...args], {
    encoding: "buffer",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    error: result.error,
    allowStdout,
  };
}

function text(result) {
  return { ok: result.status === 0, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8"), error: result.error?.message };
}

/** Resolve a device argument: a UDID, a device name, or the configured default. */
function resolveDevice(device) {
  const wanted = (device ?? process.env.IOS_SIM_DEVICE ?? DEFAULT_DEVICE).trim();
  const list = text(xcrun(["list", "devices", "-j"], { timeoutMs: 20000 }));
  if (!list.ok) return { ok: false, reason: list.stderr || list.error };
  let parsed;
  try {
    parsed = JSON.parse(list.stdout);
  } catch {
    return { ok: false, reason: "simctl list returned unparseable JSON" };
  }
  const devices = [];
  for (const [runtime, entries] of Object.entries(parsed.devices ?? {})) {
    for (const entry of entries) {
      devices.push({ ...entry, runtime });
    }
  }
  // A UDID matches directly; a name matches an available device of that name.
  const byUdid = devices.find((d) => d.udid === wanted);
  if (byUdid) return { ok: true, device: byUdid };
  const byName = devices.find((d) => d.name === wanted && d.isAvailable);
  if (byName) return { ok: true, device: byName };
  const anyByName = devices.find((d) => d.name === wanted);
  if (anyByName) {
    return { ok: false, reason: `device "${wanted}" exists but is unavailable (runtime not installed)` };
  }
  return { ok: false, reason: `no simulator named "${wanted}" — run list_devices` };
}

// -------------------------------------------------------------------- tool impls

const tools = {
  list_devices: {
    description: "List available iOS simulators (name, UDID, state, runtime).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler() {
      const result = text(xcrun(["list", "devices", "-j"], { timeoutMs: 20000 }));
      if (!result.ok) {
        return toolError(`simctl list failed: ${result.stderr || result.error || "xcrun missing?"}`);
      }
      const parsed = JSON.parse(result.stdout);
      const devices = [];
      for (const [runtime, entries] of Object.entries(parsed.devices ?? {})) {
        for (const entry of entries) {
          devices.push({
            name: entry.name,
            udid: entry.udid,
            state: entry.state,
            available: entry.isAvailable,
            runtime,
          });
        }
      }
      return jsonResult({ devices });
    },
  },

  list_runtimes: {
    description: "List installed simulator runtimes with their version and build.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler() {
      const result = text(xcrun(["list", "runtimes", "-j"], { timeoutMs: 20000 }));
      if (!result.ok) return toolError(`simctl list runtimes failed: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      return jsonResult({
        runtimes: (parsed.runtimes ?? []).map((r) => ({
          name: r.name,
          identifier: r.identifier,
          version: r.version,
          build: r.buildversion,
          available: r.isAvailable,
        })),
      });
    },
  },

  boot: {
    description: "Boot a simulator by name or UDID and wait until it is ready.",
    inputSchema: {
      type: "object",
      properties: { device: { type: "string" } },
      additionalProperties: false,
    },
    handler({ device } = {}) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      if (resolved.device.state === "Booted") return jsonResult({ booted: resolved.device.udid });
      const boot = text(xcrun(["boot", resolved.device.udid]));
      if (!boot.ok && !/already booted/i.test(boot.stderr)) {
        return toolError(`boot failed: ${boot.stderr}`);
      }
      const ready = text(xcrun(["bootstatus", resolved.device.udid, "-b"], { timeoutMs: 120000 }));
      if (!ready.ok) return toolError(`bootstatus failed: ${ready.stderr}`);
      return jsonResult({ booted: resolved.device.udid });
    },
  },

  shutdown: {
    description: "Shut down a simulator (or all simulators with device 'all').",
    inputSchema: {
      type: "object",
      properties: { device: { type: "string" } },
      additionalProperties: false,
    },
    handler({ device } = {}) {
      if (device === "all") {
        const result = text(xcrun(["shutdown", "all"]));
        if (!result.ok) return toolError(`shutdown all failed: ${result.stderr}`);
        return jsonResult({ shutdown: "all" });
      }
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["shutdown", resolved.device.udid]));
      if (!result.ok) return toolError(`shutdown failed: ${result.stderr}`);
      return jsonResult({ shutdown: resolved.device.udid });
    },
  },

  erase: {
    description: "Factory-reset a simulator: clean state, same device.",
    inputSchema: {
      type: "object",
      properties: { device: { type: "string" } },
      additionalProperties: false,
    },
    handler({ device } = {}) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const shut = text(xcrun(["shutdown", resolved.device.udid]));
      if (!shut.ok && !/not.*boot|unable to shutdown/i.test(shut.stderr)) {
        return toolError(`could not shut down before erase: ${shut.stderr}`);
      }
      const result = text(xcrun(["erase", resolved.device.udid], { timeoutMs: 120000 }));
      if (!result.ok) return toolError(`erase failed: ${result.stderr}`);
      return jsonResult({ erased: resolved.device.udid });
    },
  },

  create_device: {
    description: "Create a simulator from a device type and runtime identifier.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        device_type: { type: "string", description: "e.g. com.apple.CoreSimulator.SimDeviceType.iPhone-16" },
        runtime: { type: "string", description: "e.g. com.apple.CoreSimulator.SimRuntime.iOS-18-2" },
      },
      required: ["name", "device_type", "runtime"],
      additionalProperties: false,
    },
    handler({ name, device_type, runtime }) {
      const result = text(xcrun(["create", name, device_type, runtime], { timeoutMs: 60000 }));
      if (!result.ok) return toolError(`create failed: ${result.stderr}`);
      return jsonResult({ created: name, udid: result.stdout.trim() });
    },
  },

  install_app: {
    description: "Install a .app bundle onto a simulator.",
    inputSchema: {
      type: "object",
      properties: {
        app_path: { type: "string" },
        device: { type: "string" },
      },
      required: ["app_path"],
      additionalProperties: false,
    },
    handler({ app_path, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["install", resolved.device.udid, app_path], { timeoutMs: 180000 }));
      if (!result.ok) return toolError(`install failed: ${result.stderr}`);
      return jsonResult({ installed: app_path });
    },
  },

  uninstall_app: {
    description: "Uninstall an app by bundle id from a simulator.",
    inputSchema: {
      type: "object",
      properties: { bundle_id: { type: "string" }, device: { type: "string" } },
      required: ["bundle_id"],
      additionalProperties: false,
    },
    handler({ bundle_id, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["uninstall", resolved.device.udid, bundle_id]));
      if (!result.ok) return toolError(`uninstall failed: ${result.stderr}`);
      return jsonResult({ uninstalled: bundle_id });
    },
  },

  launch_app: {
    description: "Launch an app by bundle id; returns the launched process id.",
    inputSchema: {
      type: "object",
      properties: { bundle_id: { type: "string" }, device: { type: "string" } },
      required: ["bundle_id"],
      additionalProperties: false,
    },
    handler({ bundle_id, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["launch", resolved.device.udid, bundle_id], { timeoutMs: 60000 }));
      if (!result.ok) return toolError(`launch failed: ${result.stderr}`);
      return jsonResult({ launched: bundle_id, pid: Number(result.stdout.trim().split(":")[1] ?? 0) });
    },
  },

  terminate_app: {
    description: "Terminate a running app by bundle id.",
    inputSchema: {
      type: "object",
      properties: { bundle_id: { type: "string" }, device: { type: "string" } },
      required: ["bundle_id"],
      additionalProperties: false,
    },
    handler({ bundle_id, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["terminate", resolved.device.udid, bundle_id]));
      if (!result.ok) return toolError(`terminate failed: ${result.stderr}`);
      return jsonResult({ terminated: bundle_id });
    },
  },

  screenshot: {
    description: "Capture the simulator screen to a PNG on the host and return its path.",
    inputSchema: {
      type: "object",
      properties: { device: { type: "string" } },
      additionalProperties: false,
    },
    handler({ device } = {}) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const dir = mkdtempSync(join(tmpdir(), "ios-sim-mcp-"));
      const file = join(dir, `screenshot-${Date.now()}.png`);
      const result = text(xcrun(["io", resolved.device.udid, "screenshot", file], { timeoutMs: 60000 }));
      if (!result.ok) return toolError(`screenshot failed: ${result.stderr}`);
      return jsonResult({ path: file, device: resolved.device.name });
    },
  },

  open_url: {
    description: "Open a URL or custom scheme on the simulator (deep links, universal links).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, device: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    handler({ url, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["openurl", resolved.device.udid, url]));
      if (!result.ok) return toolError(`openurl failed: ${result.stderr}`);
      return jsonResult({ opened: url });
    },
  },

  get_container: {
    description: "Print an app's container path on the host (app, data, or groups).",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        container: { type: "string", enum: ["app", "data", "groups"] },
        device: { type: "string" },
      },
      required: ["bundle_id"],
      additionalProperties: false,
    },
    handler({ bundle_id, container = "data", device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const args = ["get_app_container", resolved.device.udid, bundle_id];
      if (container) args.push(container);
      const result = text(xcrun(args));
      if (!result.ok) return toolError(`get_app_container failed: ${result.stderr}`);
      return jsonResult({ container: result.stdout.trim() });
    },
  },

  set_appearance: {
    description: "Switch the simulator between light and dark appearance.",
    inputSchema: {
      type: "object",
      properties: {
        appearance: { type: "string", enum: ["dark", "light"] },
        device: { type: "string" },
      },
      required: ["appearance"],
      additionalProperties: false,
    },
    handler({ appearance, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["ui", resolved.device.udid, "appearance", appearance]));
      if (!result.ok) return toolError(`set appearance failed: ${result.stderr}`);
      return jsonResult({ appearance });
    },
  },

  spawn: {
    description: "Run a command inside the simulator's environment (defaults to /bin/sh -c).",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, device: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    },
    handler({ command, device }) {
      const resolved = resolveDevice(device);
      if (!resolved.ok) return toolError(resolved.reason);
      const result = text(xcrun(["spawn", resolved.device.udid, "/bin/sh", "-c", command], { timeoutMs: 60000 }));
      return jsonResult({ ok: result.ok, stdout: result.stdout, stderr: result.stderr });
    },
  },
};

// ------------------------------------------------------------------- MCP plumbing

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
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleMessage(message) {
  const { id, method, params } = message;
  if (id === undefined || id === null) return;
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ios-simulator", version: "0.1.0" },
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
      const tool = tools[params?.name];
      if (!tool) {
        send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
        return;
      }
      try {
        send({ jsonrpc: "2.0", id, result: tool.handler(params?.arguments ?? {}) });
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
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${error.message}` } });
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
