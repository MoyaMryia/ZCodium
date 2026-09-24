import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { createUsageStatsService } = await tsImport(
  "../../packages/services/src/usage-stats/usageStatsService.ts",
  import.meta.url,
);

const { appUsageSnapshotSchema } = await tsImport(
  "../../packages/shared/src/usage-stats.ts",
  import.meta.url,
);
const localSnapshot = appUsageSnapshotSchema.parse({
  range: "7d",
  generatedAt: 1,
  timeZone: "UTC",
  source: "agent-db",
  summary: {
    totalTokens: 150,
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheHitRate: 0,
    totalSessions: 1,
    totalTurns: 1,
    toolCallCount: 0,
    toolErrorRate: 0,
    modelErrorRate: 0,
    avgTimeToFirstTokenMs: 200,
    avgTurnDurationMs: 900,
    activeDays: 1,
    currentStreakDays: 1,
    longestSessionMs: 900,
    longestStreakDays: 1,
    peakDayTokens: 150,
    favoriteModel: { modelId: "fixture-model", totalTokens: 150, share: 1 },
  },
  heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
  dailyModelUsage: [],
  models: [],
  tools: [],
});

function setup() {
  const requests = [];
  const usageCalls = [];
  let credentialReads = 0;
  const snapshot = localSnapshot;
  const service = createUsageStatsService({
    env: {
      ZCODE_BIGMODEL_USAGE_QUOTA_URL: "https://quota.example.invalid/api/monitor/usage/quota/limit",
    },
    apiClient: {
      request: async (input) => {
        const path = new URL(input).pathname;
        requests.push(path);
        assert.ok(!path.includes("/mcp/"), "retired official MCP usage must not be requested");
        return Response.json(
          path === "/api/biz/subscription/list"
            ? {
                code: 200,
                data: [
                  {
                    productId: "coding-fixture",
                    productName: "Coding fixture",
                    status: "VALID",
                    inCurrentPeriod: true,
                  },
                ],
              }
            : {
                code: 200,
                data: {
                  limits: [
                    {
                      type: "TOKENS_LIMIT",
                      currentValue: 1,
                      usage: 100,
                      remaining: 99,
                      percentage: 1,
                    },
                  ],
                },
              },
        );
      },
    },
    accountRequestAuthService: {
      resolveCurrent: async () => ({ apiKey: "fixture-plan-key" }),
      assertCurrent: async () => {},
    },
    officialMcpCredentialSource: {
      resolve: async () => {
        credentialReads++;
        return { ok: false, reason: "official_auth_unavailable" };
      },
    },
    zcodeAgentService: {
      getAppUsageStats: async (request) => {
        usageCalls.push(request);
        return snapshot;
      },
    },
  });
  return { service, requests, usageCalls, snapshot, credentialReads: () => credentialReads };
}

test("remaining plan queries never access retired MCP credentials or request MCP quota", async () => {
  const f = setup();
  const snapshot = await f.service.getEntitlementSnapshot({
    preferredProviderId: "account:zai-individual-coding-plan",
    accountAccess: { type: "zhipu-account", family: "zai", planKind: "individual-coding-plan" },
    allowEnvApiKey: false,
  });
  assert.equal(f.credentialReads(), 0);
  assert.equal(snapshot.mcpQuota, null);
  assert.equal(snapshot.subscription.details[0].productName, "Coding fixture");
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((path) => !path.includes("mcp")));
});

test("local usage remains a direct Agent database query without account or network reads", async () => {
  const f = setup();
  const request = { range: "7d", timeZone: "UTC" };
  assert.equal(await f.service.getAppUsageSnapshot(request), f.snapshot);
  assert.deepEqual(f.usageCalls, [request]);
  assert.deepEqual(f.requests, []);
  assert.equal(f.credentialReads(), 0);
});

test("local usage failures are preserved so the caller can retry without false empty success", async () => {
  let attempts = 0;
  const error = new Error("Fixture Agent database unavailable");
  const service = createUsageStatsService({
    env: {},
    apiClient: {},
    accountRequestAuthService: {},
    zcodeAgentService: {
      getAppUsageStats: async () => {
        if (++attempts === 1) throw error;
        return localSnapshot;
      },
    },
  });
  await assert.rejects(
    service.getAppUsageSnapshot({ range: "7d", timeZone: "UTC" }),
    (actual) => actual === error,
  );
  assert.deepEqual(
    await service.getAppUsageSnapshot({ range: "7d", timeZone: "UTC" }),
    localSnapshot,
  );
});
