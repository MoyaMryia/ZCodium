import { BUILTIN_MODEL_PROVIDER_IDS, resolveZaiBusinessBaseUrl } from "@zcode/shared";
import type { CodingPlanSubscriptionProviderId } from "@zcode/shared";
import {
  BigModelCodingPlanSubscriptionProvider,
  createZaiLoginAuthHeaders,
} from "./bigmodelCodingPlanSubscriptionProvider.js";

/** Z.AI 团队账号查询使用对应的业务域名与凭据。 */
export class ZaiCodingPlanSubscriptionProvider extends BigModelCodingPlanSubscriptionProvider {
  protected codingPlanProviderId(): CodingPlanSubscriptionProviderId {
    return BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
  }

  protected resolveFamilyEnterpriseHost(): string {
    return resolveZaiCodingPlanHost();
  }

  protected async loadFamilyEnterpriseToken(): Promise<string> {
    // 复用父类 loadZaiAuthorization：credential key = oauth:zai:access_token。
    return this.loadZaiAuthorization();
  }

  protected createFamilyEnterpriseAuthHeaders(token: string): Record<string, string> {
    return createZaiLoginAuthHeaders(token);
  }
}

/**
 * zai 业务域名（/api/biz）。
 * 与父类 file-scoped 的 resolveZaiCodingPlanHost 等价；这里独立保留是因为父类该函数未 export。
 * 必须与父类实现保持一致：跟随产品环境（测试 配置的 ZAI Business origin / 线上 api.z.ai）。
 */
function resolveZaiCodingPlanHost(): string {
  return resolveZaiBusinessBaseUrl(process.env);
}
