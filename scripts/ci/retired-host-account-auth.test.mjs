import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tsImport } from "tsx/esm/api";

test("Host has no callable official request credential or online organization recovery capability", async () => {
  for (const file of [
    "accountRequestAuthService",
    "accountProviderRequestAuthService",
    "accountProviderConnectionResolver",
    "accountProviderTeamPlanRequestKey",
    "legacyTeamOrganizationResolver",
    "accountProviderCredentialService",
    "accountProviderApiClient",
    "accountProviderApiKeyResolver",
    "accountProviderApiTypes",
  ]) {
    await assert.rejects(
      access(new URL(`../../packages/services/src/model-provider/${file}.ts`, import.meta.url)),
      { code: "ENOENT" },
      `${file} must be removed, not left as an unused credential acquisition path`,
    );
  }
  for (const file of [
    "packages/services/src/node.ts",
    "packages/services/src/index.ts",
    "packages/desktop/src/host/index.ts",
  ]) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /AccountRequestAuth|AccountProviderApiClient|AccountProviderApiKeyResolver|createAccountProviderCredentialService|resolveAccountTeamPlanRuntimeApiKey|resolveCurrentAccountAccess|prepareLegacyAccountConnections/,
      file,
    );
  }
  const settings = await tsImport(
    "../../packages/services/src/setting/settingService.ts",
    import.meta.url,
  );
  assert.equal(settings.createSettingServiceWithMigrations, undefined);
  const teamKeys = await tsImport(
    "../../packages/services/src/bigmodel/teamPlanApiKey.ts",
    import.meta.url,
  );
  assert.equal(teamKeys.copyBigModelTeamPlanProjectApiKeySecret, undefined);
  assert.equal(teamKeys.ensureBigModelTeamPlanProjectApiKey, undefined);
});

test("legacy team settings remain offline while concurrent local preferences persist across restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zcodium-offline-settings-"));
  const previousHome = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = dir;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previousHome;
    await rm(dir, { recursive: true, force: true });
  });
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Settings must not resolve an official organization or acquire credentials");
  });
  const { createSettingService } = await tsImport(
    "../../packages/services/src/setting/settingService.ts",
    import.meta.url,
  );
  const { ZCODE_USER_DATA_DIR_NAME } = await tsImport(
    "../../packages/shared/src/index.ts",
    import.meta.url,
  );
  const file = join(dir, ZCODE_USER_DATA_DIR_NAME, "v2", "setting.json");
  const legacy = {
    providerFamilyDomain: "bigmodel",
    modelProviderFamilyModes: { bigmodel: "codingPlan" },
    modelProviderFamilySelectedKeys: {
      bigmodel: "team-plan:builtin:bigmodel-coding-plan:fixture-product:fixture-project",
    },
    locale: "en-US",
    recentProjects: ["/fixture/previous"],
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(legacy));
  const service = createSettingService();
  assert.deepEqual((await service.get()).providerFamilyConnectionSelections, {});
  await Promise.all([
    service.update({ locale: "zh-CN" }),
    service.update({ recentProjects: ["/fixture/current", "/fixture/previous"] }),
    service.update({ httpProxy: "http://127.0.0.1:19000" }),
  ]);
  const restored = await createSettingService().get();
  assert.equal(restored.locale, "zh-CN");
  assert.deepEqual(restored.recentProjects, ["/fixture/current", "/fixture/previous"]);
  assert.equal(restored.httpProxy, "http://127.0.0.1:19000");
  assert.deepEqual(restored.providerFamilyConnectionSelections, {});
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.modelProviderFamilyModes, legacy.modelProviderFamilyModes);
  assert.deepEqual(
    persisted.modelProviderFamilySelectedKeys,
    legacy.modelProviderFamilySelectedKeys,
  );
  assert.equal(Object.hasOwn(persisted, "providerFamilyConnectionSelections"), false);
  assert.equal(fetch.mock.callCount(), 0);
});
