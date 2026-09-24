import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { createNodeHttpClientAdapter, createNodeWebFetchHttpClientAdapter } = await tsImport(
  "../../apps/zcode-cli/packages/adapters/src/http/index.ts",
  import.meta.url,
);

async function listen(server, t) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const route of ["direct", "proxy", "no-proxy"]) {
  test(
    `HTTP ${route} preserves explicit headers and local diagnostics without exporting trace identity`,
    { timeout: 10000 },
    async (t) => {
      const requests = [];
      const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        requests.push({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, { "Content-Type": "text/plain", "X-Fixture-Response": "ok" });
        res.end("Fixture response");
      });
      const address = await listen(server, t);
      const proxied = route === "proxy";
      const url = `${proxied ? "http://fixture.invalid" : address}/fixture?q=1`;
      const client =
        route === "direct"
          ? createNodeHttpClientAdapter({ env: {} })
          : createNodeWebFetchHttpClientAdapter({
              env: {},
              proxyUrl: address,
              ...(route === "no-proxy" ? { noProxy: "127.0.0.1" } : {}),
            });
      const trace = Object.freeze({
        traceId: "private-local-trace",
        sessionId: "private-local-session",
      });
      const headers = Object.freeze({
        Authorization: "Bearer fixture-key",
        "X-Fixture": "user-header",
      });
      const response = await client.request({
        url,
        method: "POST",
        headers,
        trace,
        body: Buffer.from("Fixture input"),
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, proxied ? url : "/fixture?q=1");
      assert.equal(requests[0].method, "POST");
      assert.equal(requests[0].body, "Fixture input");
      assert.equal(requests[0].headers.authorization, "Bearer fixture-key");
      assert.equal(requests[0].headers["x-fixture"], "user-header");
      assert.equal(requests[0].headers["x-zcode-trace-id"], undefined);
      assert.ok(!JSON.stringify(requests).includes("private-local"));
      assert.equal(response.status, 200);
      assert.equal(Buffer.from(response.body).toString(), "Fixture response");
      assert.equal(response.headers["x-fixture-response"], "ok");
      assert.equal(response.bytes, Buffer.byteLength("Fixture response"));
      assert.ok(response.durationMs >= 0);
      assert.equal(response.egress.proxied, proxied);
      if (route === "no-proxy") assert.equal(response.egress.noProxyMatched, true);
      // 显式用户请求头仍属于请求语义，不能以隐私清理为由擅自删除或覆盖。
      await client.request({ url, trace, headers: { "X-ZCode-Trace-ID": "user-selected-value" } });
      assert.equal(requests[1].headers["x-zcode-trace-id"], "user-selected-value");
      assert.equal(trace.traceId, "private-local-trace");
      assert.equal(headers["X-Fixture"], "user-header");
    },
  );
}

test(
  "public HTTP egress still rejects private DNS results before any network request",
  { timeout: 10000 },
  async (t) => {
    let requests = 0;
    let lookups = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.end("Unexpected request");
    });
    await listen(server, t);
    const client = createNodeWebFetchHttpClientAdapter({
      env: {},
      dnsLookup: async () => {
        lookups++;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    await assert.rejects(
      client.request({
        url: `http://fixture.invalid:${server.address().port}/private`,
        egressPolicy: "public",
        trace: { traceId: "private-local-trace" },
      }),
      (error) => error.code === "egress_blocked",
    );
    assert.equal(lookups, 1);
    assert.equal(requests, 0);
  },
);

test(
  "HTTP cancellation still aborts an in-flight request without leaking trace identity",
  { timeout: 10000 },
  async (t) => {
    let accept;
    const received = new Promise((resolve) => {
      accept = resolve;
    });
    const server = createServer((req) => {
      accept(req.headers);
    });
    const url = await listen(server, t);
    const client = createNodeHttpClientAdapter({ env: {} });
    const controller = new AbortController();
    const rejected = assert.rejects(
      client.request(
        { url, trace: { traceId: "private-local-trace" } },
        { signal: controller.signal },
      ),
      (error) => error.code === "cancelled",
    );
    const headers = await received;
    controller.abort(new Error("Fixture cancelled"));
    await rejected;
    assert.equal(headers["x-zcode-trace-id"], undefined);
  },
);
