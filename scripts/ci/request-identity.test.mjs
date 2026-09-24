import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { NodeApiClient } = await tsImport(
  "../../packages/services/src/providers/api/nodeApiClient.ts",
  import.meta.url,
);
const { ManifestUpdateProvider } = await tsImport(
  "../../packages/desktop/src/main/manifestUpdateProvider.ts",
  import.meta.url,
);
const { DEFAULT_ZCODE_ENDPOINT_ORIGIN } = await tsImport(
  "../../packages/shared/src/zcodeEndpoint.ts",
  import.meta.url,
);

test("API requests preserve explicit headers without adding device or environment fingerprints", async () => {
  const calls = [];
  const client = new NodeApiClient({
    resolveZCodeEndpointOrigin: () => "https://endpoint.example",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init.headers) });
      return new Response("ok");
    },
  });
  await client.request(`${DEFAULT_ZCODE_ENDPOINT_ORIGIN}/api/v1/example`, {
    headers: { Authorization: "Bearer fixture-token", "X-Custom": "user-value" },
  });
  await client.request("https://model.example/v1/models", {
    headers: { "api-key": "fixture-key" },
  });
  assert.equal(calls[0].url, "https://endpoint.example/api/v1/example");
  assert.deepEqual([...calls[0].headers.keys()], ["authorization", "x-custom", "x-request-id"]);
  assert.deepEqual([...calls[1].headers.keys()], ["api-key", "x-request-id"]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer fixture-token");
  assert.equal(calls[1].headers.get("api-key"), "fixture-key");
  assert.ok(calls[0].headers.get("x-request-id"));
  assert.notEqual(calls[0].headers.get("x-request-id"), calls[1].headers.get("x-request-id"));
});

test("explicit request IDs and cancellation still obey the existing API contract", async () => {
  let calls = 0;
  const client = new NodeApiClient({
    fetchImpl: async (_input, init) => {
      calls++;
      assert.equal(new Headers(init.headers).get("x-request-id"), "explicit-request");
      return new Response("ok");
    },
  });
  await client.request("https://model.example", {
    headers: { "x-request-id": "explicit-request" },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.request("https://model.example", { signal: controller.signal }));
  assert.equal(calls, 1);
});

test("update manifest requests select platform/channel without a device query or header", async () => {
  const provider = new ManifestUpdateProvider(
    {
      provider: "custom",
      endpointOrigin: "https://updates.example",
      releasePlatform: "linux-x86_64",
      releaseChannel: "stable",
      deviceMid: "obsolete-device-value",
    },
    {},
    { executor: {}, isUseMultipleRangeRequest: false },
  );
  let request;
  provider.httpRequest = async (url, headers) => {
    request = { url, headers: new Headers(headers) };
    return "version: 1.2.3\nfiles: []\n";
  };
  assert.equal((await provider.getLatestVersion()).version, "1.2.3");
  assert.deepEqual([...request.url.searchParams.keys()].sort(), ["channel", "platform"]);
  assert.equal(request.url.searchParams.get("platform"), "linux-x86_64");
  assert.equal(request.headers.has("x-device-mid"), false);
  assert.equal(request.headers.get("x-release-channel"), "1");
});
