import { contextBridge, ipcRenderer } from "electron";
import {
  CodingPlanWebviewChannels,
  isTrustedCodingPlanWebviewOrigin,
  PlatformChannels,
} from "@zcode/shared";

// Coding Plan 官网页 preload：
// - 在官网页主世界挂 window.zcodeBridge，暴露三个能力：
//   1) notifyPurchaseComplete：购买完成后通过 sendToHost 通知 host renderer；
//   2) getLang / onLangChange：读取 App 当前 locale 并订阅运行时切换；
//   3) openExternal：用系统默认浏览器打开外链。webview 内 <a target="_blank">
//      默认会被 setWindowOpenHandler 路由到内部 Browser tab，但官网侧希望
//      条款/管理等外链直接拉起系统浏览器，由官网脚本拦截后调此方法转发。
// - getLang 读 main world 的 window.__zcodeLang__（由 App executeJavaScript 注入）；
//   onLangChange 在 main world 监听 zcode-coding-plan-lang-change CustomEvent
//   （同样由 App executeJavaScript 在 locale 变化时派发）。
//   因为整个 bridge 通过 contextBridge.executeInMainWorld 挂在 main world，
//   与页面脚本共享同一 window，事件能通。
// - 官网页主世界拿不到 Node / ipcRenderer 原语，只暴露业务函数。
// 参照 embeddedBrowserJavaScriptDialog.ts 的 contextBridge.executeInMainWorld 模式
// （sandbox=true + contextIsolation=true 下可用，已有先例）。
//
// 注入时机：Electron webview 在 will-attach-webview 钩子里按 params.src 判断为官网购买页时，
// 把 webPreferences.preload 切到本文件（见 desktopWindowChrome.ts）。

const PUBLIC_BRIDGE_KEY = "zcodeBridge";
const NATIVE_BRIDGE_KEY = "__zcodeCodingPlanWebviewNativeBridge__";
const LANG_VAR = "__zcodeLang__";
const LANG_CHANGE_EVENT = "zcode-coding-plan-lang-change";

function isTrustedCodingPlanBridgeLocation(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: process.env.VITE_ZCODE_E2E_STORE_BRIDGE === "1",
      })
    ) {
      return false;
    }
    if (!url.pathname.includes("coding-plan")) return false;
    if (url.searchParams.get("embedded") === "app") return true;
    // PayPal 回跳页本身不带 embedded=app，但 returnTo 指回内嵌购买页；
    // 该页支付成功后仍需 zcodeBridge.notifyPurchaseComplete 通知 App 刷新模型设置。
    if (!url.pathname.endsWith("/coding-plan/payment/callback")) return false;
    const returnTo = url.searchParams.get("returnTo");
    if (!returnTo) return false;
    const target = new URL(returnTo, url.origin);
    return (
      target.origin === url.origin &&
      target.pathname.includes("coding-plan") &&
      target.searchParams.get("embedded") === "app" &&
      !target.pathname.endsWith("/coding-plan/payment/callback")
    );
  } catch {
    return false;
  }
}

interface NotifyPurchaseCompletePayload {
  provider: "zai" | "bigmodel";
}

interface CodingPlanNativeBridge {
  notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload): void;
  openExternal(url: string): void;
}

// Coding Plan guest 导航到 PayPal 时仍会复用同一个 preload 配置。
// bridge 只允许暴露给可信官网购买页，避免第三方授权页继承 App 通信能力。
if (isTrustedCodingPlanBridgeLocation()) {
  contextBridge.exposeInMainWorld(NATIVE_BRIDGE_KEY, {
    notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload) {
      try {
        ipcRenderer.sendToHost(CodingPlanWebviewChannels.PurchaseComplete, {
          provider: payload.provider,
          timestamp: Date.now(),
        } satisfies import("@zcode/shared").CodingPlanPurchaseCompletePayload);
      } catch {
        // host renderer 尚未 attach 或 webview 被销毁时 sendToHost 会抛；
        // 官网页自身不依赖此调用成功，静默即可。
      }
    },
    openExternal(url: string) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        ipcRenderer.send(PlatformChannels.OpenExternal, {
          sourceUrl: window.location.href,
          url: parsed.toString(),
        });
      } catch {
        // 非法 URL 忽略，避免官网页通过 bridge 发送任意 IPC payload。
      }
    },
  } satisfies CodingPlanNativeBridge);

  contextBridge.executeInMainWorld({
    func: (
      publicBridgeKey: string,
      nativeBridgeKey: string,
      langVar: string,
      langChangeEvent: string,
    ) => {
      const nativeBridge = (
        window as unknown as Record<string, CodingPlanNativeBridge | undefined>
      )[nativeBridgeKey];
      if (!nativeBridge) return;
      const bridge = {
        notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload) {
          if (payload?.provider !== "zai" && payload?.provider !== "bigmodel") {
            return;
          }
          nativeBridge.notifyPurchaseComplete(payload);
        },
        // 返回 App 当前 locale；App 尚未注入时为 null（website 据此判断是否嵌入环境）。
        getLang() {
          // 注意：executeInMainWorld 的 func 体不经过 TS 编译，不能用 as 断言等 TS 语法。
          const value = (window as unknown as Record<string, unknown>)[langVar];
          return value === "zh-CN" || value === "en-US" ? value : null;
        },
        // 订阅 App locale 运行时变化，返回取消订阅函数。
        // App locale 变化时用 executeJavaScript 派发 zcode-coding-plan-lang-change 事件。
        onLangChange(callback: (locale: "zh-CN" | "en-US") => void) {
          const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ locale?: unknown }>).detail;
            if (detail && (detail.locale === "zh-CN" || detail.locale === "en-US")) {
              callback(detail.locale);
            }
          };
          window.addEventListener(langChangeEvent, handler);
          return () => window.removeEventListener(langChangeEvent, handler);
        },
        openExternal(url: string) {
          nativeBridge.openExternal(url);
        },
      };
      Object.defineProperty(window, publicBridgeKey, {
        value: bridge,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    },
    args: [PUBLIC_BRIDGE_KEY, NATIVE_BRIDGE_KEY, LANG_VAR, LANG_CHANGE_EVENT],
  });
}
