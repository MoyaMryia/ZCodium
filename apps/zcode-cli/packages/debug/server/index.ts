import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { inspectTrace, listTraces } from "./analyzer.js";
import { createObservationEventStream } from "./observation-events.js";
import type { ObservationOptions } from "./types.js";

interface DebugAppOptions {
  staticRoot?: string;
}

interface DebugServerOptions extends DebugAppOptions {
  host?: string;
  port?: number;
}

export function createDebugApp(options: DebugAppOptions = {}): Hono {
  const app = new Hono();
  app.use("*", cors());

  app.get("/api/health", (context) =>
    context.json({
      ok: true,
      service: "zcode-debug",
    }),
  );

  app.get("/api/traces", async (context) =>
    context.json(await listTraces(queryToOptions(context.req.query()))),
  );

  app.get("/api/traces/:traceId", async (context) => {
    const traceId = context.req.param("traceId");
    return context.json(await inspectTrace(traceId, queryToOptions(context.req.query())));
  });

  app.get("/api/observations/events", (context) => {
    const stream = createObservationEventStream(queryToOptions(context.req.query()));
    return context.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
  });

  // API 已移除时必须返回 404，不能被 SPA fallback 伪装成可用接口。
  app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));

  if (options.staticRoot && existsSync(options.staticRoot)) {
    app.use("/*", serveStatic({ root: options.staticRoot }));
    app.get("*", async (context) => {
      const index = await readFile(join(options.staticRoot ?? "", "index.html"), "utf8");
      return context.html(index);
    });
  }

  return app;
}

export function startDebugServer(options: DebugServerOptions = {}) {
  const port = options.port ?? 4174;
  const hostname = options.host ?? "127.0.0.1";
  const app = createDebugApp(options);
  const server = serve({
    fetch: app.fetch,
    hostname,
    port,
  });
  return server;
}

function queryToOptions(query: Record<string, string>): ObservationOptions {
  return {
    sessionId: query.sessionId || undefined,
    logDir: query.logDir || undefined,
    dbPath: query.dbPath || undefined,
    eventPath: query.eventPath || undefined,
    projectId: query.projectId || undefined,
    limit: parsePositiveInteger(query.limit),
  };
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const staticRoot = resolve(process.cwd(), "dist");
  const server = startDebugServer({
    staticRoot,
    port: parsePositiveInteger(process.env.PORT) ?? 4174,
  });
  server.on("listening", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 4174;
    console.log(`debug listening on http://127.0.0.1:${port}`);
  });
}
