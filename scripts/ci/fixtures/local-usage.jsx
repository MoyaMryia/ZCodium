import { createRoot } from "react-dom/client";
import { appUsageSnapshotSchema } from "@zcode/shared";
import { UsageStatsSection } from "../../../packages/ui/src/settings/UsageStatsSection.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
document.documentElement.className = params.get("theme") === "dark" ? "dark zai-dark" : "zai-light";
const fixture = (window.localUsageFixture = {
  requests: [],
  forbidden: [],
  failNext: params.has("failure"),
  holdNext: false,
  release: null,
});
function snapshot({ range, timeZone }) {
  const modelId = `${range}-model`;
  return appUsageSnapshotSchema.parse({
    range,
    timeZone,
    source: "agent-db",
    generatedAt: Date.now(),
    summary: {
      totalTokens: 12345,
      inputTokens: 10000,
      outputTokens: 2345,
      reasoningTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalSessions: 2,
      totalTurns: 3,
      toolCallCount: 4,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: 400,
      avgTurnDurationMs: 900,
      activeDays: 1,
      currentStreakDays: 1,
      longestSessionMs: 120000,
      longestStreakDays: 1,
      peakDayTokens: 12345,
      favoriteModel: { modelId, totalTokens: 12345, share: 1 },
    },
    heatmap: {
      startDate: "2026-09-24",
      endDate: "2026-09-24",
      maxTokens: 12345,
      weeks: [
        {
          weekIndex: 0,
          days: [
            { date: "2026-09-24", level: 4, totalTokens: 12345, turnCount: 3, toolCallCount: 4 },
            null,
            null,
            null,
            null,
            null,
            null,
          ],
        },
      ],
    },
    dailyModelUsage: [{ date: "2026-09-24", models: [{ modelId, totalTokens: 12345 }] }],
    models: [
      {
        modelId,
        totalTokens: 12345,
        inputTokens: 10000,
        outputTokens: 2345,
        requestCount: 3,
        share: 1,
      },
    ],
    tools: [
      { toolName: "fixture-tool", callCount: 4, errorCount: 0, errorRate: 0, avgDurationMs: 40 },
    ],
  });
}
const service = new Proxy(
  {
    async getAppUsageSnapshot(request) {
      fixture.requests.push(request);
      if (fixture.failNext && request.range !== "all") {
        fixture.failNext = false;
        throw new Error("Fixture local database unavailable");
      }
      if (fixture.holdNext && request.range !== "all") {
        fixture.holdNext = false;
        await new Promise((resolve) => {
          fixture.release = resolve;
        });
      }
      return snapshot(request);
    },
  },
  {
    get(target, key) {
      if (key in target) return target[key];
      fixture.forbidden.push(String(key));
      throw new Error(`Unexpected non-local usage method: ${String(key)}`);
    },
  },
);
createRoot(document.getElementById("root")).render(
  <ServiceProvider services={{ usageStatsService: service }}>
    <ZCodeIntlProvider initialLocale={locale}>
      <TooltipProvider>
        <main className="min-h-screen bg-background text-foreground p-4">
          <UsageStatsSection />
        </main>
      </TooltipProvider>
    </ZCodeIntlProvider>
  </ServiceProvider>,
);
