import { stat } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_PLUGIN_REQUIRED_PATHS } from "@zcode/shared/builtin-plugin-assets";

/** Validate complete executable/skill inputs before producing an installable release. */
export async function validateBuiltinPluginAssets(packagesDirectory) {
  for (const relativePath of BUILTIN_PLUGIN_REQUIRED_PATHS) {
    const path = join(packagesDirectory, relativePath);
    const entry = await stat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry?.isFile()) throw new Error(`Missing builtin plugin asset: ${relativePath}`);
  }
}
