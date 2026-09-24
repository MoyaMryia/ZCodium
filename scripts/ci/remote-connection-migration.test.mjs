import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { sshConnectOptionsSchema, appSettingsSchema } = await tsImport(
  "../../packages/shared/src/validation.ts",
  import.meta.url,
);

test("legacy download modes are discarded while SSH identity and credentials survive", () => {
  for (const assetInstallMode of ["local-download-upload", "remote-download"]) {
    const target = {
      kind: "ssh",
      host: "fixture.invalid",
      username: "fixture",
      sshConfigAlias: "test-host",
      port: 2222,
    };
    assert.deepEqual(
      sshConnectOptionsSchema.parse({ ...target, assetInstallMode, password: "test-only" }),
      { ...target, password: "test-only" },
    );
    const entry = {
      kind: "remote",
      workspacePath: "/fixture",
      workspaceIdentity: "fixture-identity",
      target: { ...target, assetInstallMode, passwordCredentialKey: "fixture-key" },
      lastOpenedAt: 1,
      lastConnectionStatus: "connected",
    };
    const settings = appSettingsSchema.parse({ lastWorkspaceSession: [entry] });
    assert.deepEqual(settings.lastWorkspaceSession, [
      { ...entry, target: { ...target, passwordCredentialKey: "fixture-key" } },
    ]);
  }
});
