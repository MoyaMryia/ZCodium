import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tsImport } from "tsx/esm/api";

const storeModule = await tsImport("./fixtures/local-credential-store.ts", import.meta.url);
const {
  createSharedZCodeCredentialStore,
  createZCodeCredentialCipher,
  publishCanonicalCredentials,
  loadCanonicalCredentials,
  invalidateCanonicalCredentials,
  saveDiscoveryRecord,
  refreshMcpOAuthTokensUnderLock,
} = storeModule;
const env = { ZCODE_CREDENTIAL_SECRET: "fixture-local-encryption-secret" };
const prefix = "mcp:fixture-self-managed";
const opaqueLegacy = "enc:v1:opaque-retired-fixture";
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-credentials-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "credentials.json");
  await writeFile(filePath, JSON.stringify({ "oauth:zai:user_info": opaqueLegacy }));
  const options = { filePath, env };
  return { directory, filePath, options, store: createSharedZCodeCredentialStore(options) };
}

test("generic CLI credential storage exposes no proprietary login or synchronous read API", async (t) => {
  const { store, filePath } = await fixture(t);
  const before = await readFile(filePath, "utf8");
  assert.equal(store.saveZaiLoginCredentials, undefined);
  assert.equal(store.clearZaiLoginCredentials, undefined);
  assert.equal(storeModule.SHARED_ZCODE_CREDENTIAL_KEYS, undefined);
  assert.equal(storeModule.loadSharedZCodeCredentialSync, undefined);
  assert.equal(await readFile(filePath, "utf8"), before);
});

test("encrypted MCP publication preserves unrelated records and stale invalidation cannot delete a newer pair", async (t) => {
  const { store, options, filePath } = await fixture(t);
  const other = createSharedZCodeCredentialStore(options);
  let notifications = 0;
  const dispose = store.onDidChange(async () => {
    notifications++;
  });
  t.after(dispose);
  const input = (id) => ({
    clientInformation: { client_id: `fixture-client-${id}` },
    publishedBy: `fixture-publisher-${id}`,
    tokens: {
      access_token: `fixture-access-${id}`,
      refresh_token: `fixture-refresh-${id}`,
      token_type: "Bearer",
      expires_in: 3600,
    },
  });
  const [first, second] = await Promise.all([
    publishCanonicalCredentials(store, prefix, input(1)),
    publishCanonicalCredentials(other, prefix, input(2)),
  ]);
  await Promise.all([
    store.save("mcp:other:key", "fixture-other"),
    other.save("model:custom:key", "fixture-model"),
  ]);
  const current = await loadCanonicalCredentials(store, prefix);
  const winner = current.raw === first.raw ? first : second;
  const stale = winner === first ? second : first;
  const values = await other.loadMany([
    `${prefix}:client_information`,
    `${prefix}:tokens`,
    "mcp:other:key",
    "model:custom:key",
  ]);
  assert.equal(values[`${prefix}:client_information`], winner.legacyClientRaw);
  assert.equal(values[`${prefix}:tokens`], winner.legacyTokensRaw);
  assert.equal(values["mcp:other:key"], "fixture-other");
  assert.equal(values["model:custom:key"], "fixture-model");
  assert.equal(await invalidateCanonicalCredentials(other, prefix, stale.raw, "all"), false);
  assert.equal((await loadCanonicalCredentials(store, prefix)).raw, winner.raw);
  const raw = await readFile(filePath, "utf8");
  assert.doesNotMatch(raw, /fixture-access|fixture-refresh|fixture-model|fixture-other/);
  assert.equal(JSON.parse(raw)["oauth:zai:user_info"], opaqueLegacy);
  assert.equal(notifications, 5);
  assert.equal(await invalidateCanonicalCredentials(store, prefix, winner.raw, "tokens"), true);
  assert.equal(await loadCanonicalCredentials(other, prefix), undefined);
  assert.equal(await other.load(`${prefix}:client_information`), winner.legacyClientRaw);
  assert.equal(await other.load(`${prefix}:tokens`), null);
  const wrongCipher = createZCodeCredentialCipher({
    env: { ZCODE_CREDENTIAL_SECRET: "fixture-wrong-secret" },
  });
  const wrong = createSharedZCodeCredentialStore({ ...options, cipher: wrongCipher });
  await assert.rejects(wrong.load("mcp:other:key"), /decrypt failed/);
});

test(
  "concurrent MCP refresh exchanges once and persists the new pair without official login state",
  { timeout: 15000 },
  async (t) => {
    const { store, options, filePath } = await fixture(t);
    const issuer = "https://fixture.invalid";
    await publishCanonicalCredentials(store, prefix, {
      clientInformation: { client_id: "fixture-client", token_endpoint_auth_method: "none" },
      publishedBy: "fixture-original",
      issuer,
      tokens: {
        access_token: "fixture-expired",
        refresh_token: "fixture-refresh-old",
        token_type: "Bearer",
        expires_in: 0,
      },
    });
    await saveDiscoveryRecord(store, prefix, {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
      },
    });
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const observed = Promise.withResolvers();
    let exchanges = 0;
    const input = {
      credentialStore: store,
      keyPrefix: prefix,
      reactive: true,
      serverName: "Fixture MCP",
      serverUrl: `${issuer}/mcp`,
      async fetchFn(url, init) {
        exchanges++;
        assert.equal(String(url), `${issuer}/token`);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "fixture-refresh-old");
        entered.resolve();
        await release.promise;
        return Response.json({
          access_token: "fixture-access-new",
          refresh_token: "fixture-refresh-new",
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    };
    const first = refreshMcpOAuthTokensUnderLock(input);
    await entered.promise;
    const other = createSharedZCodeCredentialStore(options);
    const second = refreshMcpOAuthTokensUnderLock({
      ...input,
      credentialStore: {
        ...other,
        async loadMany(keys) {
          const result = await other.loadMany(keys);
          observed.resolve();
          return result;
        },
      },
    });
    await observed.promise;
    release.resolve();
    assert.deepEqual(await Promise.all([first, second]), [
      "fixture-access-new",
      "fixture-access-new",
    ]);
    assert.equal(exchanges, 1);
    const restored = await loadCanonicalCredentials(
      createSharedZCodeCredentialStore(options),
      prefix,
    );
    assert.equal(restored.tokens.refresh_token, "fixture-refresh-new");
    assert.ok(restored.expiresAt > Date.now());
    const raw = await readFile(filePath, "utf8");
    assert.doesNotMatch(raw, /fixture-access-new|fixture-refresh-new/);
    assert.equal(JSON.parse(raw)["oauth:zai:user_info"], opaqueLegacy);
  },
);

test("corrupt shared credentials are backed up and cannot be overwritten by a new MCP login", async (t) => {
  const { store, directory, filePath } = await fixture(t);
  const corrupt = "{fixture broken record";
  await writeFile(filePath, corrupt);
  await assert.rejects(store.save("mcp:fixture:key", "fixture-new"), /credentials are corrupt/);
  assert.equal(await readFile(filePath, "utf8"), corrupt);
  const files = await readdir(directory);
  assert.ok(files.some((file) => file.startsWith("credentials.json.corrupt")));
});
