import { z } from "zod";

const helpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//iu.test(value))
  .optional()
  .catch(undefined);
const helpConfigSchema = z.object({
  community_urls: z
    .object({
      "zh-CN": helpUrlSchema,
      "en-US": helpUrlSchema,
    })
    .optional()
    .catch(undefined),
  feedback_url: helpUrlSchema,
  feedback_use_external_form: z.boolean().optional().catch(undefined),
});
export type HelpAppConfig = z.infer<typeof helpConfigSchema>;

/** 帮助入口只由随包本地配置提供，不接受官方远端覆盖。 */
export function resolveHelpAppConfig(local: unknown): HelpAppConfig {
  const config = helpConfigSchema.safeParse(local).data;
  return {
    community_urls: {
      "zh-CN": config?.community_urls?.["zh-CN"],
      "en-US": config?.community_urls?.["en-US"],
    },
    feedback_url: config?.feedback_url,
    // 配置缺失不能意外打开旧官方反馈表单。
    feedback_use_external_form: config?.feedback_use_external_form ?? true,
  };
}
