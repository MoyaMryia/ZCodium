import type { TuiPromptInput } from "@zcode/tui";
import type { SlashCommand } from "./slash-command-types.js";
import type { CommandCenterDeps } from "./types.js";

import { isRetiredAccountCommand } from "../retired-account-command.js";

export async function recordSlashCommandInHistory(
  deps: CommandCenterDeps,
  input: TuiPromptInput,
  command: SlashCommand,
): Promise<void> {
  if (!deps.recordInputHistory || isRetiredAccountCommand(command.rawName)) return;
  try {
    await deps.recordInputHistory(input, "slash_command");
  } catch {
    // Input history is recall UX; command execution must not depend on it.
  }
}
