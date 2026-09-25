import { z } from "zod";

const sharedContextImportStatusSchema = z.enum(["pending", "reserved", "attached", "discarded"]);
export type SharedContextImportStatus = z.infer<typeof sharedContextImportStatusSchema>;
const localArchiveSourceSchema = z
  .object({
    kind: z.literal("localArchive"),
    archiveSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

const localArchiveImportStateSchema = z
  .object({
    contextId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    source: localArchiveSourceSchema,
    status: sharedContextImportStatusSchema,
  })
  .strict();

const sharedContextImportV2StateSchema = z
  .object({
    contextId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    shareUrl: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            url.search === "" &&
            url.hash === "" &&
            /^\/cn\/share\/[^/]+$/u.test(url.pathname)
          );
        } catch {
          return false;
        }
      }, "shareUrl must use the canonical /cn/share/<code> path"),
    status: sharedContextImportStatusSchema,
  })
  .strict();
// 旧会话只读兼容保留规范 URL 形状；本地归档使用独立 source 分支。

const legacySharedContextImportStateSchema = z.object({ title: z.string().trim().min(1) }).strict();

export const sharedContextImportStateSchema = z.union([
  localArchiveImportStateSchema,
  sharedContextImportV2StateSchema,
  legacySharedContextImportStateSchema,
]);

export type SharedContextImportState = z.infer<typeof sharedContextImportStateSchema>;

const sharedContextProvenanceFields = {
  shareId: z.string().trim().min(1),
  projectionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  artifactSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  formatterVersion: z.literal(1),
  markdownSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  installedArtifacts: z.array(
    z
      .object({
        artifactId: z.string().trim().min(1),
        workspaceRelativePath: z.string().trim().min(1),
      })
      .strict(),
  ),
};

/** 会话创建沿用原子导入；文件来源和旧 URL 来源互斥。 */
export const sharedContextImportProvenanceSchema = z.union([
  z
    .object({
      ...sharedContextProvenanceFields,
      contextId: z.string().trim().min(1),
      status: sharedContextImportStatusSchema,
      source: localArchiveSourceSchema,
    })
    .strict(),
  z
    .object({
      ...sharedContextProvenanceFields,
      contextId: z.string().trim().min(1).optional(),
      status: sharedContextImportStatusSchema.optional(),
      shareUrl: z.string().url().optional(),
    })
    .strict(),
]);

/** 冷恢复和 admission 更新共用来源校验，避免本地来源因没有 shareUrl 丢失 contextId。 */
export function restoreSharedContextImportState(
  title: string | null | undefined,
  provenance: unknown,
  status?: SharedContextImportStatus,
): SharedContextImportState | undefined {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return undefined;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return { title: normalizedTitle };
  }
  const record = provenance as Record<string, unknown>;
  const candidate = {
    contextId: record.contextId,
    title: normalizedTitle,
    status: status ?? record.status,
    ...("source" in record ? { source: record.source } : {}),
    ...("shareUrl" in record ? { shareUrl: record.shareUrl } : {}),
  };
  const result = sharedContextImportStateSchema.safeParse(candidate);
  // 损坏的来源只保留标题，不能把混合/未知来源静默解释成可以 attach 的旧云记录。
  return result.success ? result.data : { title: normalizedTitle };
}
