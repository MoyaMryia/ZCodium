import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { tsImport } from "tsx/esm/api";

test("desktop and remote client no longer expose an official OAuth service", async () => {
  const { RemoteServiceAccess } = await tsImport(
    "../../packages/client/src/remoteServiceAccess.ts",
    import.meta.url,
  );
  const channels = [];
  const calls = [];
  const services = new RemoteServiceAccess({
    getChannel(name) {
      channels.push(name);
      return { call: async (...args) => calls.push([name, ...args]), listen: () => () => {} };
    },
  });
  assert.equal(channels.includes("oauth"), false);
  assert.equal("oauthService" in services, false);
  await services.credentialService.load("fixture-mcp-key");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "load");
  for (const file of [
    "packages/services/src/node.ts",
    "packages/services/src/index.ts",
    "packages/desktop/src/host/remoteWorkspaceServiceCollection.ts",
  ]) {
    assert.doesNotMatch(
      await readFile(new URL(`../../${file}`, import.meta.url), "utf8"),
      /OAuthService|OAuthCredentialRepo|OAuthProviderLogout|isCurrentOAuthCredentialRequest/,
    );
  }
  await assert.rejects(
    access(new URL("../../packages/services/src/oauth/oauthService.ts", import.meta.url)),
    { code: "ENOENT" },
  );
});

test("user API 401 preserves the response without inspecting credentials or logging out", async () => {
  const { createNodeApiClient } = await tsImport(
    "../../packages/services/src/providers/api/nodeApiClient.ts",
    import.meta.url,
  );
  const forbidden = () => {
    throw new Error("Retired OAuth callback accessed");
  };
  const response = new Response("Fixture unauthorized", { status: 401 });
  const client = createNodeApiClient(
    new Proxy(
      {
        fetchImpl: async (url, init) => {
          assert.equal(url, "https://fixture.invalid/v1/models");
          assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-api-key");
          return response;
        },
      },
      {
        get(target, key) {
          if (["isZcodeJwtRequest", "onZcodeJwtInvalid"].includes(key)) return forbidden();
          return target[key];
        },
      },
    ),
  );
  assert.equal(
    await client.request("https://fixture.invalid/v1/models", {
      headers: { Authorization: "Bearer fixture-api-key" },
    }),
    response,
  );
});
