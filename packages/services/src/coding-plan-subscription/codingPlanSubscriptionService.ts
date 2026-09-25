import type { ApiClient, DynamicWorkflowClientConfig } from "@zcode/shared";
import {
  buildRuntimeZCodeApiUrl,
  ZCODE_VERSION,
  createDynamicWorkflowClientConfig,
  normalizeDynamicWorkflowMode,
  resolveDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  ZCODE_DYNAMIC_WORKFLOW_MODE_ENV,
} from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";

const CLIENT_CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
const log = createServiceLogger("codingPlanSubscription");

interface ClientConfigEnvelope {
  data?: {
    configs?: {
      dynamicWorkflow?: { mode?: unknown } | null;
    } | null;
  } | null;
}

export function createCodingPlanSubscriptionService(dependencies: {
  apiClient: ApiClient;
}): ICodingPlanSubscriptionService {
  let snapshot: ClientConfigEnvelope | null = null;
  let expiresAt = 0;
  let request: Promise<ClientConfigEnvelope> | null = null;

  async function getClientConfigs(): Promise<ClientConfigEnvelope> {
    if (snapshot && expiresAt > Date.now()) return snapshot;
    if (request) return request;
    const url = new URL(buildRuntimeZCodeApiUrl(process.env, "/api/v1/client/configs"));
    url.searchParams.set("app_version", ZCODE_VERSION);
    url.searchParams.set("platform", `${process.platform}-${process.arch}`);
    request = readApiJson<ClientConfigEnvelope>(dependencies.apiClient, url, {
      method: "GET",
      timeoutMs: 15_000,
    });
    try {
      snapshot = await request;
      expiresAt = Date.now() + CLIENT_CONFIG_CACHE_TTL_MS;
      return snapshot;
    } finally {
      request = null;
    }
  }

  return {
    async getDynamicWorkflowClientConfig(options?: {
      forceRefresh?: boolean;
    }): Promise<DynamicWorkflowClientConfig> {
      if (normalizeDynamicWorkflowMode(process.env[ZCODE_DYNAMIC_WORKFLOW_MODE_ENV])) {
        return resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env });
      }
      if (options?.forceRefresh) {
        snapshot = null;
        expiresAt = 0;
      }
      try {
        const payload = await getClientConfigs();
        return resolveDynamicWorkflowClientConfig({
          remote: payload.data?.configs?.dynamicWorkflow,
          env: process.env,
        });
      } catch (error) {
        log.warn(undefined, "动态工作流灰度配置读取失败，按关闭处理", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
      }
    },
  };
}
