import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * AstrBot 走独立桥接服务（`astrbotBridgeService` + `botsBridgeServer`），
 * 没有平台凭据/二维码，因此不复用 `ProviderSettingsCard` 的凭据流程，
 * 只引导用户用桥接插件连接本机桥接运行时文件。
 */
export const ASTRBOT_BRIDGE_RUNTIME_FILE = ".zcodium/v2/bots-bridge.runtime.v2.json";
export const ASTRBOT_PLUGIN_URL = "https://github.com/axiom-desu/astrbot-zcodium-plugin";

export function AstrBotSettingsCard({ onOpenPlugin }: { onOpenPlugin: () => void }) {
  const { intl } = useZCodeIntl();

  const handleCopyPath = () => {
    void navigator.clipboard?.writeText(ASTRBOT_BRIDGE_RUNTIME_FILE).catch((error: unknown) => {
      logger.warn("[BotsDialog] 复制 AstrBot 桥接配置路径失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "bots.astrbot.bridgeLabel" })}
        description={intl.formatMessage({ id: "bots.astrbot.bridgeDescription" })}
        control={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="lg" onClick={handleCopyPath}>
              <Copy className="size-4" />
              {intl.formatMessage({ id: "bots.astrbot.copyPath" })}
            </Button>
            <Button variant="outline" size="lg" onClick={onOpenPlugin}>
              <ExternalLink className="size-4" />
              {intl.formatMessage({ id: "bots.astrbot.openPlugin" })}
            </Button>
          </div>
        }
        detail={
          <div className="rounded-lg bg-background p-3 text-ui-base leading-5 text-foreground-subtle">
            <div>{intl.formatMessage({ id: "bots.astrbot.runtimeFilePath" })}</div>
            <div className="mt-1 break-all rounded-md bg-surface px-2 py-1 font-mono text-foreground">
              {ASTRBOT_BRIDGE_RUNTIME_FILE}
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>{intl.formatMessage({ id: "bots.astrbot.step.install" })}</li>
              <li>{intl.formatMessage({ id: "bots.astrbot.step.configure" })}</li>
              <li>{intl.formatMessage({ id: "bots.astrbot.step.bind" })}</li>
            </ol>
          </div>
        }
      />
    </SettingsGroupCard>
  );
}
