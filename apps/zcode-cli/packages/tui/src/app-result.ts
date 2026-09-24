import type { CollaborationMode, ModelUsageSummary, TodoItem, TurnId } from "@zcode/contracts";
import { getZCodeCopy } from "@zcode/i18n";
import React from "react";
import { validContextUsage } from "./app-event-data.js";
import type {
  CacheStats,
  ContextUsage,
  Message,
  ModifiedFileStat,
  NetworkRequest,
  QueuedInput,
  SelectionState,
} from "./app-model.js";
import { appendAgentResult } from "./app-submit.js";
import { createSelectionState } from "./app-selection-state.js";
import type { TuiOptions, TuiSubmitPromptResult } from "./types.js";

type TuiApplyResultInput = {
  fallback: {
    locale: NonNullable<TuiOptions["locale"]>;
    modelSetupRequired: boolean;
    mode: CollaborationMode;
    model: string;
  };
  modifiedFileToolCallIds: Set<string>;
  setActiveTurnId: (turnId: TurnId | undefined) => void;
  setCacheStats: React.Dispatch<React.SetStateAction<CacheStats | undefined>>;
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage>>;
  setEffortOptions: React.Dispatch<React.SetStateAction<NonNullable<TuiOptions["effortOptions"]>>>;
  setLastEvent: (event: string) => void;
  setLiveModelText: (value: string) => void;
  setLocale: (locale: NonNullable<TuiOptions["locale"]>) => void;
  setModelSetupRequired: (modelSetupRequired: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setMode: React.Dispatch<React.SetStateAction<CollaborationMode>>;
  setModel: (model: string) => void;
  setModelOptions: React.Dispatch<React.SetStateAction<NonNullable<TuiOptions["modelOptions"]>>>;
  setModifiedFiles: React.Dispatch<React.SetStateAction<ModifiedFileStat[]>>;
  setNetworkRequests: React.Dispatch<React.SetStateAction<NetworkRequest[]>>;
  setQueuedInputs: React.Dispatch<React.SetStateAction<QueuedInput[]>>;
  setSelection: React.Dispatch<React.SetStateAction<SelectionState | undefined>>;
  setStatus: (status: string) => void;
  setThoughtLevel: (thoughtLevel: string) => void;
  setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
  setTraceId: (traceId: string | undefined) => void;
  setUsage: React.Dispatch<React.SetStateAction<ModelUsageSummary | undefined>>;
  workspaceDirectory?: string;
};

export function useTuiApplyResult(input: TuiApplyResultInput) {
  return React.useCallback(
    (result: TuiSubmitPromptResult, preserveTurnState = false) => {
      const resultCopy = getZCodeCopy(result.locale ?? input.fallback.locale).tui;
      input.setMode(result.mode ?? input.fallback.mode);
      input.setModel(result.model ?? input.fallback.model);
      if (result.locale) input.setLocale(result.locale);
      if (result.modelSetupRequired !== undefined)
        input.setModelSetupRequired(result.modelSetupRequired);
      if (result.effortOptions) input.setEffortOptions(result.effortOptions);
      if (result.modelOptions) input.setModelOptions(result.modelOptions);
      if ("thoughtLevel" in result) input.setThoughtLevel(result.thoughtLevel ?? "");
      input.setMessages((current) =>
        appendAgentResult(current, result, { workspaceDirectory: input.workspaceDirectory }),
      );
      if (preserveTurnState) {
        input.setStatus("Agent is still responding.");
        return;
      }
      input.setTraceId(result.traceId);
      input.setLiveModelText("");

      if (result.turnId) input.setActiveTurnId(result.turnId as TurnId);
      if (result.usage) input.setUsage(result.usage);
      if (result.projection) {
        input.setContextUsage((current) => ({
          ...current,
          ...validContextUsage(result.projection ?? {}),
        }));
      }
      if (result.resetSessionProjection) {
        input.setUsage(undefined);
        input.setContextUsage({});
        input.setCacheStats(undefined);
        input.setTodos([]);
        input.setNetworkRequests([]);
        input.setModifiedFiles([]);
        input.modifiedFileToolCallIds.clear();
      }

      input.setSelection(createSelectionState(result.selection));
      input.setQueuedInputs([]);
      const activeModelSetupRequired =
        result.modelSetupRequired ?? input.fallback.modelSetupRequired;
      input.setStatus(
        result.selection
          ? result.selection.prompt
          : activeModelSetupRequired
            ? resultCopy.modelSetupRequired.status
            : resultCopy.status.ready,
      );
      input.setLastEvent(result.turnId ? `turn ${result.turnId}` : "complete");
    },
    [input],
  );
}
