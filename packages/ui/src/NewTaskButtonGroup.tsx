import { ChevronDown, FileUp, LoaderCircle, MessageCirclePlus } from "lucide-react";
import { TID_TASK_NEW_BUTTON } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { useConversationImport } from "@/hooks/useConversationImport.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";

export function NewTaskButtonGroup({
  onCreateTask,
  disabled = false,
}: {
  onCreateTask: () => void;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const newTaskShortcutLabel = useShortcutCommandLabel("newTask");
  const importing = useConversationImport();
  return (
    <div
      role="group"
      data-testid={TID_TASK_NEW_BUTTON}
      className="flex h-8 w-full shrink-0 gap-0.5"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onCreateTask}
        className={cn(
          "inline-flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-ui-base hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
          disabled && "cursor-not-allowed text-foreground-subtlest hover:bg-transparent",
        )}
      >
        <MessageCirclePlus className="size-4 shrink-0" />
        <span className="truncate">{intl.formatMessage({ id: "taskList.newThread" })}</span>
        <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtlest">
          {newTaskShortcutLabel}
        </span>
      </button>
      {importing?.available ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled || importing.busy}
              aria-busy={importing.busy}
              aria-label={intl.formatMessage({ id: "conversationShare.import.menu" })}
              className="flex w-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused disabled:opacity-50"
            >
              {importing.busy ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={importing.open}>
              <FileUp className="size-4" aria-hidden="true" />
              {intl.formatMessage({ id: "conversationShare.import.fromFile" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
