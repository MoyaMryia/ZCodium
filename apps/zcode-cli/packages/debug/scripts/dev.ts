import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { startDebugServer } from "../server/index.js";

const apiPort = 4174;
const root = fileURLToPath(new URL("..", import.meta.url));
const apiServer = startDebugServer({ port: apiPort });
await once(apiServer, "listening");

const vite = await createViteServer({
  root,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
});
await vite.listen();

console.log(`[debug] API listening on http://127.0.0.1:${apiPort}`);
vite.printUrls();

async function shutdown(server: ReturnType<typeof startDebugServer>): Promise<void> {
  await vite.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(apiServer).finally(() => process.exit(0));
  });
}
