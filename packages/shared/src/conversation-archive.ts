import { z } from "zod";
import {
  conversationShareArtifactDescriptorSchema,
  conversationShareSha256Schema,
} from "./conversation-share.js";
import { conversationRowSchema } from "./zcode-protocol-v4/rows.js";

export const CONVERSATION_ARCHIVE_LIMITS = Object.freeze({
  manifestBytes: 4 * 1024 * 1024,
  archiveBytes: 72 * 1024 * 1024,
  artifactBytes: 16 * 1024 * 1024,
  totalArtifactBytes: 64 * 1024 * 1024,
  artifacts: 128,
  rows: 5_000,
  jsonDepth: 64,
  jsonNodes: 250_000,
});

export const conversationArchiveArtifactSchema = conversationShareArtifactDescriptorSchema
  .omit({ original_path: true })
  .extend({
    artifact_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/u),
    display_name: z.string().min(1).max(255),
    size_bytes: z.number().int().min(0).max(CONVERSATION_ARCHIVE_LIMITS.artifactBytes),
  })
  .strict();
export type ConversationArchiveArtifact = z.infer<typeof conversationArchiveArtifactSchema>;

/** 离线分享只携带用户选择的公开内容，不包含源路径、账号或运行时配置。 */
export const conversationArchiveContentSchema = z
  .object({
    format: z.literal("zcodium-conversation"),
    version: z.literal(1),
    title: z.string().min(1).max(512),
    selectedProductTurnIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(CONVERSATION_ARCHIVE_LIMITS.rows),
    rows: z.array(conversationRowSchema).min(1).max(CONVERSATION_ARCHIVE_LIMITS.rows),
    artifacts: z
      .array(conversationArchiveArtifactSchema)
      .max(CONVERSATION_ARCHIVE_LIMITS.artifacts),
  })
  .strict();
export type ConversationArchiveContent = z.infer<typeof conversationArchiveContentSchema>;

export const conversationArchiveManifestSchema = z
  .object({
    content: conversationArchiveContentSchema,
    sha256: conversationShareSha256Schema,
  })
  .strict();

export type ConversationArchiveErrorCode =
  | "invalid_archive"
  | "unsupported_version"
  | "limit_exceeded"
  | "integrity_mismatch";
