import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export function reply(message, context = {}) {
  if (!("id" in message)) return;
  const response = { jsonrpc: "2.0", id: message.id };
  switch (message.method) {
    case "initialize":
      return {
        ...response,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        },
      };
    case "ping":
      return { ...response, result: {} };
    case "tools/list":
      return {
        ...response,
        result: { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] },
      };
    case "tools/call":
      return {
        ...response,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ...context,
                meta: message.params._meta ?? {},
                arguments: message.params.arguments,
              }),
            },
          ],
          ...(message.params.arguments?.fail ? { isError: true } : {}),
        },
      };
    default:
      return { ...response, error: { code: -32601, message: "Unknown fixture method" } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const result = reply(JSON.parse(line), { configuredEnv: process.env.ZCODE_FIXTURE_MCP_VALUE });
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
