import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { createCodingPlanSubscriptionService } = await tsImport(
  "../../packages/services/src/coding-plan-subscription/codingPlanSubscriptionService.ts",
  import.meta.url,
);
const { createUsageStatsService } = await tsImport(
  "../../packages/services/src/usage-stats/usageStatsService.ts",
  import.meta.url,
);
const { ProxyChannel } = await tsImport("../../packages/rpc/src/proxy-channel.ts", import.meta.url);

test("retired payment RPC cannot read credentials or contact a payment endpoint", async () => {
  const forbidden = () => {
    throw new Error("Payment IO must not occur");
  };
  const service = createCodingPlanSubscriptionService({
    apiClient: new Proxy({}, { get: () => forbidden }),
    credentialService: { load: forbidden },
  });
  const channel = ProxyChannel.fromService(service);
  for (const command of [
    "preview",
    "batchPreview",
    "getStaticProducts",
    "getStartPlanPreview",
    "productInfo",
    "createSign",
    "updateSign",
    "checkPayment",
    "checkPendingOrders",
    "queryStripeCards",
    "bindStripeCard",
    "unbindStripeCard",
    "payStripe",
    "checkPaypalSupport",
    "createPaypalSetupToken",
    "subscribePaypal",
    "getEnterpriseBalance",
    "calculateEnterpriseOrder",
    "createEnterpriseOrder",
    "getEnterprisePendingOrders",
    "cancelEnterpriseOrder",
    "continueEnterpriseOrderPayment",
    "checkEnterpriseOrderStatus",
  ]) {
    assert.throws(
      () => channel.call(undefined, command, [{ providerId: "fixture", bizId: "fixture" }]),
      /Method not found/,
    );
  }
});

test("local App Usage still reads Agent statistics without any account or payment IO", async () => {
  const forbidden = () => {
    throw new Error("Official IO must not occur");
  };
  const requests = [];
  const result = { fixture: "local usage" };
  const service = createUsageStatsService({
    apiClient: new Proxy({}, { get: () => forbidden }),
    credentialService: { load: forbidden },
    accountRequestAuthService: new Proxy({}, { get: () => forbidden }),
    zcodeAgentService: {
      getAppUsageStats: async (request) => {
        requests.push(request);
        return result;
      },
    },
  });
  assert.equal(await service.getAppUsageSnapshot({ range: "week", timeZone: "UTC" }), result);
  assert.deepEqual(requests, [{ range: "week", timeZone: "UTC" }]);
});
