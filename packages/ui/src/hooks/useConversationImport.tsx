import { createContext, useContext } from "react";

export interface ConversationImportAction {
  available: boolean;
  busy: boolean;
  open: () => void;
}
const ConversationImportContext = createContext<ConversationImportAction | null>(null);
export const ConversationImportProvider = ConversationImportContext.Provider;
export function useConversationImport(): ConversationImportAction | null {
  return useContext(ConversationImportContext);
}
