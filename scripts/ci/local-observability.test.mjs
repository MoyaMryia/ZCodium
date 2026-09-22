import { tsImport } from "tsx/esm/api";
import { fileURLToPath } from "node:url";

await tsImport(
  "../../apps/zcode-cli/packages/bootstrap/test/local-observability.test.ts",
  import.meta.url,
);
await tsImport("../../packages/ui/test/localOnlyWebview.test.ts", import.meta.url);
await tsImport("../../packages/ui/test/localDiagnostics.test.ts", {
  parentURL: import.meta.url,
  tsconfig: fileURLToPath(new URL("../../packages/ui/tsconfig.json", import.meta.url)),
});
await tsImport(
  "../../apps/zcode-cli/packages/bootstrap/test/local-measurements.test.ts",
  import.meta.url,
);
await tsImport(
  "../../apps/zcode-cli/packages/cli/test/direct-diagnostics.test.ts",
  import.meta.url,
);
