import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatErrorBanner } from "../../../packages/ui/src/ChatErrorBanner.js";
import { McpToolCallBlock } from "../../../packages/ui/src/ToolCallBlocks/renderers/mcp.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.className = theme === "dark" ? "dark zai-dark" : "zai-light";
window.errorFixture = { copies: [], retries: 0, diagnostics: 0 };
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(text) {
      window.errorFixture.copies.push(text);
    },
  },
});
const platform = {
  openFeedback() {
    window.errorFixture.diagnostics++;
  },
};
function Fixture() {
  const [visible, setVisible] = useState(true);
  return (
    <main className="min-h-screen bg-background text-foreground p-4 space-y-6">
      {visible && (
        <ChatErrorBanner
          error={{
            code: params.get("code") || "1005",
            message: "Fixture provider limit reached",
            detail: "Fixture safe error detail",
            traceId: "local-fixture-trace",
          }}
          onRetry={() => window.errorFixture.retries++}
          onDismiss={() => setVisible(false)}
        />
      )}
      <section aria-label="MCP tool result">
        <McpToolCallBlock
          toolCallNode={{
            type: "tool_call",
            toolCall: {
              toolId: "fixture-mcp-failure",
              title: "Fixture MCP",
              toolName: "mcp__fixture__query",
              status: "failed",
              error: "Fixture MCP connection failed",
              raw: {
                display: {
                  kind: "mcp_tool",
                  serverName: "fixture",
                  toolName: "query",
                  unavailable: { code: "coding_plan_required" },
                },
              },
            },
          }}
          statusLabel={locale === "zh-CN" ? "失败" : "Failed"}
          errorText="Fixture MCP connection failed"
          theme={theme}
          forceOpen
          isRunning={false}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale={locale}>
      <TooltipProvider>
        <Fixture />
      </TooltipProvider>
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
