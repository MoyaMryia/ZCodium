interface CustomAboutDialogHtmlInput {
  applicationName: string;
  appVersion: string;
  copyright: string;
  optimizationLine: string;
  versionLabel: string;
  okButtonLabel: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createCustomAboutDialogHtml(input: CustomAboutDialogHtmlInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <title>${escapeHtml(input.applicationName)}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        --startup-page-bg: #f4f4f5;
        --about-primary: #0a0a0a;
        --about-primary-foreground: #fafafa;
        --about-primary-active: color-mix(in oklab, var(--about-primary) 80%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--startup-page-bg);
      }

      body {
        display: grid;
        place-items: center;
        padding: 0;
        user-select: none;
      }

      .about-window {
        width: 100%;
        max-width: 256px;
        height: 280px;
        display: grid;
        place-items: stretch;
        padding: 0;
        background: transparent;
      }

      .about-card {
        width: 100%;
        height: 100%;
        padding: 22px 15px 14px;
        display: flex;
        flex-direction: column;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #1d1d1f;
        box-shadow: none;
        -webkit-app-region: drag;
      }

      .content {
        width: 100%;
        max-width: 222px;
        margin: 0 auto;
        flex: 1;
        min-height: 0;
      }

      .app-icon {
        width: 52px;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        background: linear-gradient(180deg, #000000 0%, #151718 100%);
        color: #ffffff;
        box-shadow: 0 10px 13px -3px rgb(0 0 0 / 0.2), 0 4px 5px -3px rgb(0 0 0 / 0.2);
      }

      .app-logo {
        width: 30px;
        height: auto;
        display: block;
      }

      .title {
        margin: 20px 0 0;
        font-size: 13.5px;
        line-height: 1.18;
        font-weight: 700;
        letter-spacing: 0;
      }

      .meta {
        margin-top: 28px;
        display: flex;
        flex-direction: column;
        gap: 17px;
        font-size: 13px;
        line-height: 1.2;
        font-weight: 400;
        letter-spacing: 0;
        color: #303033;
      }


      .ok-button {
        width: 100%;
        height: 36px;
        border: 0;
        border-radius: 18px;
        background: var(--about-primary);
        color: var(--about-primary-foreground);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
        outline: none;
        cursor: default;
        -webkit-app-region: no-drag;
      }

      .ok-button:active {
        background: var(--about-primary-active);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --startup-page-bg: #171717;
          --about-primary: #fafafa;
          --about-primary-foreground: #0a0a0a;
          --about-primary-active: color-mix(in oklab, var(--about-primary) 80%, transparent);
        }

        .about-card {
          color: #e8e8e8;
        }

        .meta {
          color: #e2e2e2;
        }
      }
    </style>
  </head>
  <body>
    <main class="about-window" aria-label="${escapeHtml(input.applicationName)} About Window">
      <section class="about-card" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div class="content">
          <div class="app-icon" aria-hidden="true">
            <img
              src="data:image/png;base64,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"
              alt=""
              width="118"
              height="100"
              class="app-logo"
              focusable="false"
            />
          </div>
          <h1 id="about-title" class="title">
            ${escapeHtml(input.applicationName)}<br />
            ${escapeHtml(input.versionLabel)} ${escapeHtml(input.appVersion)}
          </h1>
          <div class="meta">
            ${input.optimizationLine ? `<div>${escapeHtml(input.optimizationLine)}</div>` : ""}
            <div>${escapeHtml(input.copyright)}</div>
          </div>
        </div>
        <div class="spacer"></div>
        <button class="ok-button" type="button" autofocus>${escapeHtml(input.okButtonLabel)}</button>
      </section>
    </main>
    <script>
      const closeWindow = () => window.close();
      document.querySelector(".ok-button")?.addEventListener("click", closeWindow);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          closeWindow();
        }
      });
    </script>
  </body>
</html>`;
}
