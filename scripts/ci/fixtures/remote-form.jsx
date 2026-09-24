import { createRoot } from "react-dom/client";
import { useState } from "react";
import { RemoteConnectionFields } from "../../../packages/ui/src/RemoteConnectionFields.js";
import { useRemoteConnectionForm } from "../../../packages/ui/src/hooks/useRemoteConnectionForm.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { buildRemoteTarget } from "../../../packages/ui/src/lib/remoteConnectionWizard.js";

const platform = {
  listSSHConfigAliases: async () => [],
  selectFile: async () => "/fixture/id_ed25519",
};

function RemoteForm() {
  const form = useRemoteConnectionForm({ open: true, isWindowsDesktop: false });
  const { intl } = useZCodeIntl();
  const [result, setResult] = useState(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setResult(buildRemoteTarget(intl, form));
      }}
    >
      <RemoteConnectionFields {...form} runtimeOptionsLoading={form.currentRuntimeOptionsLoading} />
      <button type="submit">Submit fixture</button>
      <output data-testid="target">{JSON.stringify(result)}</output>
    </form>
  );
}

createRoot(document.getElementById("root")).render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale="en-US">
      <RemoteForm />
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
