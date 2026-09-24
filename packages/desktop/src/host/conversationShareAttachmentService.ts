import { Event as RpcEvent } from "@zcode/rpc";
import type { IConversationShareService, IZCodeAgentService } from "@zcode/services";
import { conversationShareConnectionScopeFactory } from "@zcode/services/node";

type ConversationShareAgentService = Pick<
  IZCodeAgentService,
  | "conversationRowsRangeV4"
  | "conversationFileChangesV4"
  | "conversationAttachmentReadV4"
  | "conversationAttachmentStatV4"
>;

type ConnectionScopableConversationShareService = IConversationShareService & {
  [conversationShareConnectionScopeFactory](
    agentService: ConversationShareAgentService,
  ): IConversationShareService;
};

function isConnectionScopableConversationShareService(
  service: IConversationShareService,
): service is ConnectionScopableConversationShareService {
  return (
    conversationShareConnectionScopeFactory in service &&
    typeof service[conversationShareConnectionScopeFactory] === "function"
  );
}

export function scopeConversationShareServiceForAttachment(
  service: IConversationShareService,
  clientMode: "desktop-continuous" | "web-remote-replayable",
  agentService?: ConversationShareAgentService,
): IConversationShareService {
  if (clientMode === "desktop-continuous") {
    if (!isConnectionScopableConversationShareService(service)) return service;
    if (agentService) return service[conversationShareConnectionScopeFactory](agentService);
    const rejectUnavailable = async (): Promise<never> => {
      throw Object.assign(new Error("Conversation sharing connection is not ready"), {
        kind: "connection_unavailable" as const,
      });
    };
    return {
      getCapabilities: () => service.getCapabilities(),
      preflight: (input) => service.preflight(input),
      publish: rejectUnavailable,
      readExportChunk: rejectUnavailable,
      releaseExport: async () => {},
      onDynamicPublishProgress: (operationId) => service.onDynamicPublishProgress(operationId),
      importShare: (input, operationId) => service.importShare(input, operationId),
      onDynamicImportProgress: (operationId) => service.onDynamicImportProgress(operationId),
      getImportedConversation: (input) => service.getImportedConversation(input),
      getPreview: (shareCode) => service.getPreview(shareCode),
      getContinuation: (input) => service.getContinuation(input),
    };
  }
  const rejectMobileShare = async (): Promise<never> => {
    throw Object.assign(new Error("Conversation sharing is only available from Desktop"), {
      kind: "feature_disabled" as const,
    });
  };
  return {
    getCapabilities: () => service.getCapabilities(),
    preflight: rejectMobileShare,
    publish: rejectMobileShare,
    readExportChunk: rejectMobileShare,
    releaseExport: async () => {},
    onDynamicPublishProgress: () => RpcEvent.None,
    importShare: rejectMobileShare,
    onDynamicImportProgress: () => RpcEvent.None,
    // 手机远控没有本地 workspace 副本，直接返回 null 即可（不渲染只读块）。
    getImportedConversation: async () => null,
    getPreview: (shareCode: string) => service.getPreview(shareCode),
    getContinuation: rejectMobileShare,
  };
}
