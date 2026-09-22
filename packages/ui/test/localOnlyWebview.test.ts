import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  createCodingPlanAuthInjectionScript,
  createCodingPlanCredentialClearScript,
} from "../src/settings/model-provider-section/codingPlanEmbeddedWebview.js";

for (const provider of ["zai", "bigmodel"] as const) {
  test(`${provider} webview receives credentials and display settings without analytics identity`, () => {
    const storage = new Map<string, string>([
      ["zcode:coding-plan:report-context", '{"device_mid":"previous-device"}'],
    ]);
    const events: Array<{ type: string; detail: unknown }> = [];
    const host: Record<string, unknown> = {
      __zcodeReportContext__: { device_mid: "previous-device" },
      dispatchEvent(event: { type: string; detail: unknown }) {
        events.push(event);
      },
    };
    const context = {
      window: host,
      localStorage: {
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      document: { documentElement: { classList: { toggle() {} } } },
      CustomEvent: class {
        constructor(
          public type: string,
          public options: { detail: unknown },
        ) {}
        get detail() {
          return this.options.detail;
        }
      },
    };
    runInNewContext(
      `${createCodingPlanCredentialClearScript()};${createCodingPlanAuthInjectionScript({
        provider,
        credentials: {
          zaiAccessToken: "test-zai-token",
          bigmodelAccessToken: "test-bigmodel-token",
          zcodeJwtToken: "test-billing-token",
        },
        theme: "zai-dark",
        locale: "zh-CN",
      })}`,
      context,
    );
    assert.equal(storage.get(`oauth:${provider}:access_token`), `test-${provider}-token`);
    assert.equal(storage.get("zcodejwttoken"), "test-billing-token");
    assert.equal(storage.get("zcode-theme"), "zai-dark");
    assert.equal(host.__zcodeLang__, "zh-CN");
    assert.equal(storage.has("zcode:coding-plan:report-context"), false);
    assert.equal("__zcodeReportContext__" in host, false);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "zcode-coding-plan-auth-ready");
    assert.equal(JSON.stringify(events[0]?.detail), JSON.stringify({ provider, locale: "zh-CN" }));
  });
}
