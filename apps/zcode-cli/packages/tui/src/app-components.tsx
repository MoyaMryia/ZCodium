import React from "react";
import type { TuiCopy } from "@zcode/i18n";
import type { SlashCommand } from "./app-model.js";
import { palette } from "./app-model.js";
import { visibleSlashCommandWindow } from "./app-input.js";
import { DEFAULT_TUI_COPY } from "./app-locale.js";
import { SIDEBAR_OVERLAY_BACKGROUND, type SidebarLayout } from "./app-sidebar-layout.js";
import { displayWidth, wordWrappedLineCount } from "./app-terminal-width.js";

const h = React.createElement as (
  type: React.ElementType | string,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
) => React.ReactElement;

const SLASH_COMMAND_VISIBLE_COUNT = 6;
const SLASH_COMMAND_PANEL_CHROME_ROWS = 2;
const SLASH_COMMAND_FALLBACK_CONTENT_WIDTH = 80;
const MIN_SLASH_COMMAND_CONTENT_WIDTH = 8;
const SLASH_COMMAND_SELECTOR_WIDTH = 2;
const SLASH_COMMAND_SUMMARY_GAP_WIDTH = 2;
const APP_SHELL_HORIZONTAL_PADDING_COLUMNS = 2;
const APP_MAIN_MARGIN_RIGHT_COLUMNS = 1;
const PANEL_HORIZONTAL_CHROME_COLUMNS = 4;
const APP_MAIN_MIN_WIDTH = 40;

export function AppShell({
  children,
  onMouseUp,
  sidebar,
  sidebarLayout,
}: {
  children: React.ReactNode;
  onMouseUp?: () => void;
  sidebar: React.ReactNode | null;
  sidebarLayout: SidebarLayout;
}): React.ReactElement {
  const dockedSidebar = sidebarLayout.visible && !sidebarLayout.overlay ? sidebar : null;
  const overlaySidebar = sidebarLayout.visible && sidebarLayout.overlay ? sidebar : null;

  return h(
    "box",
    {
      onMouseUp,
      style: {
        backgroundColor: palette.background,
        flexDirection: "row",
        height: "100%",
        padding: 0,
        width: "100%",
      },
    },
    h(
      "box",
      {
        style: {
          flexDirection: "column",
          flexGrow: 1,
          height: "100%",
          marginRight: dockedSidebar ? 1 : 0,
          minWidth: APP_MAIN_MIN_WIDTH,
          padding: 1,
        },
      },
      children,
    ),
    dockedSidebar,
    overlaySidebar
      ? h(
          "box",
          {
            style: {
              alignItems: "flex-end",
              backgroundColor: SIDEBAR_OVERLAY_BACKGROUND,
              bottom: 0,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
              zIndex: 10,
            },
          },
          overlaySidebar,
        )
      : null,
  );
}

export function SlashSuggestionPanel({
  commands,
  contentWidth,
  copy = DEFAULT_TUI_COPY,
  selectedIndex,
}: {
  commands: readonly SlashCommand[];
  contentWidth?: number;
  copy?: TuiCopy;
  selectedIndex: number;
}): React.ReactElement | null {
  if (commands.length === 0) return null;
  const visible = visibleSlashCommandWindow(commands, selectedIndex, SLASH_COMMAND_VISIBLE_COUNT);
  const rowContentWidth = normalizeSlashCommandContentWidth(contentWidth);
  // Fixed one-row heights let wrapped text draw over later commands in narrow terminals.
  const rows = visible.commands.map((command, index) => {
    const selected = index === visible.selectedIndex;
    const parts = slashCommandRowParts(command, selected);
    return {
      command,
      parts,
      selected,
      height: slashCommandRowHeight(parts, rowContentWidth),
    };
  });
  const panelHeight =
    SLASH_COMMAND_PANEL_CHROME_ROWS + rows.reduce((height, row) => height + row.height, 0);
  return h(
    "box",
    {
      title: copy.slash.title,
      style: {
        backgroundColor: palette.panel,
        border: true,
        borderColor: palette.border,
        flexDirection: "column",
        height: panelHeight,
        marginBottom: 1,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      },
    },
    ...rows.map((row) =>
      h(
        "box",
        {
          key: row.command.name,
          style: {
            alignItems: "flex-start",
            flexDirection: "row",
            height: row.height,
            width: "100%",
          },
        },
        h(
          "text",
          {
            style: {
              fg: row.selected ? palette.accent : palette.muted,
              flexShrink: 0,
              width: SLASH_COMMAND_SELECTOR_WIDTH,
            },
          },
          row.parts.selector,
        ),
        h(
          "text",
          {
            style: {
              fg: row.selected ? palette.accent : palette.text,
              flexShrink: 0,
              width: displayWidth(row.parts.command),
            },
          },
          row.parts.command,
        ),
        h("text", { style: { fg: palette.muted, flexShrink: 0 } }, "  "),
        h(
          "text",
          {
            style: {
              fg: palette.muted,
              flexShrink: 1,
              minWidth: 1,
              wrapMode: "word",
            },
          },
          row.parts.summary,
        ),
      ),
    ),
  );
}

export function actionPanelContentWidthForTerminal(
  terminalWidth: number,
  sidebarWidth: number,
): number {
  const mainMarginRight = sidebarWidth > 0 ? APP_MAIN_MARGIN_RIGHT_COLUMNS : 0;
  const mainWidth = Math.max(
    APP_MAIN_MIN_WIDTH,
    Math.floor(terminalWidth) -
      sidebarWidth -
      APP_SHELL_HORIZONTAL_PADDING_COLUMNS -
      mainMarginRight,
  );
  return normalizeSlashCommandContentWidth(mainWidth - PANEL_HORIZONTAL_CHROME_COLUMNS);
}

export function ModelSetupRequiredPanel({
  copy = DEFAULT_TUI_COPY,
}: {
  copy?: TuiCopy;
} = {}): React.ReactElement {
  return h(
    "box",
    {
      title: copy.modelSetupRequired.title,
      style: {
        backgroundColor: palette.panel,
        border: true,
        borderColor: palette.warning,
        flexDirection: "column",
        height: 5,
        marginBottom: 1,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      },
    },
    h("text", { style: { fg: palette.warning } }, copy.modelSetupRequired.message),
    h("text", { style: { fg: palette.muted } }, copy.modelSetupRequired.help),
  );
}

function slashCommandRowParts(
  command: SlashCommand,
  selected: boolean,
): {
  command: string;
  selector: string;
  summary: string;
} {
  return {
    command: `/${command.name}`,
    selector: `${selected ? ">" : " "} `,
    summary: command.summary,
  };
}

function slashCommandRowHeight(
  parts: ReturnType<typeof slashCommandRowParts>,
  rowContentWidth: number,
): number {
  const summaryWidth = Math.max(
    1,
    rowContentWidth -
      SLASH_COMMAND_SELECTOR_WIDTH -
      displayWidth(parts.command) -
      SLASH_COMMAND_SUMMARY_GAP_WIDTH,
  );
  return wordWrappedLineCount(parts.summary, summaryWidth);
}

function normalizeSlashCommandContentWidth(contentWidth: number | undefined): number {
  if (contentWidth === undefined || !Number.isFinite(contentWidth)) {
    return SLASH_COMMAND_FALLBACK_CONTENT_WIDTH;
  }
  return Math.max(MIN_SLASH_COMMAND_CONTENT_WIDTH, Math.floor(contentWidth));
}
