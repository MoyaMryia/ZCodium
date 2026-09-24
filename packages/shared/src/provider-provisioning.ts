import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";

const nonEmptyString = z.string().trim().min(1);

export const providerProvisioningTriggerSchema = z.enum([
  "environment-online",
  "personal-config",
  "configured-default",
]);
export type ProviderProvisioningTrigger = z.infer<typeof providerProvisioningTriggerSchema>;

/** Personal Config 的 Envelope；具体字段由 @zcode/provider 在目标 Environment 再校验。 */
export const providerProvisioningPersonalConfigSchema = z
  .object({
    providerConfigRules: z.object({ providerRules: z.array(z.unknown()) }).strict(),
    modelConfigRules: z
      .object({
        providerModelRules: z.array(z.unknown()),
        manualProviderModelRules: z.array(z.unknown()),
      })
      .strict(),
    providerOrder: z.array(nonEmptyString).optional(),
    defaultModelSelection: modelSelectionSchema.optional(),
  })
  .strict();

export type ProviderProvisioningPersonalConfig = z.infer<
  typeof providerProvisioningPersonalConfigSchema
>;

export const providerProvisioningEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    syncId: nonEmptyString,
    personalConfig: providerProvisioningPersonalConfigSchema,
  })
  .strict();

export type ProviderProvisioningEnvelope = z.infer<typeof providerProvisioningEnvelopeSchema>;

export const providerProvisioningResultSchema = z
  .object({
    syncId: nonEmptyString,
    status: z.enum(["applied", "already-applied", "unsupported", "failed", "rollback_failed"]),
    personalProviderCount: z.number().int().nonnegative(),
    configRevision: nonEmptyString.optional(),
    errorMessage: z.string().optional(),
    rolledBack: z.boolean(),
  })
  .strict();

export type ProviderProvisioningResult = z.infer<typeof providerProvisioningResultSchema>;
