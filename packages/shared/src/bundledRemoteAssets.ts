import { z } from "zod";
import { BUILTIN_PLUGIN_REQUIRED_PATHS } from "./builtinPluginAssets.js";
import { ACTIVE_REMOTE_RESOURCE_PACKAGE_IDS } from "./remoteResourcePackages.js";

export const BUNDLED_REMOTE_PLATFORM = "linux-x64";
export const BUNDLED_REMOTE_MANIFEST = `manifest-${BUNDLED_REMOTE_PLATFORM}.json`;

const mounts: Record<string, string> = {
  "server-bundle": "server",
  "node-runtime": "node/linux-x64",
  "node-pty": "node-pty/linux-x64",
  glm: "glm/linux-x64",
  bfs: "tools/linux-x64/bfs",
  ripgrep: "tools/linux-x64/ripgrep",
  ugrep: "tools/linux-x64/ugrep",
};

export function remoteComponentRequiredPaths(id: string): string[] {
  switch (id) {
    case "server-bundle":
      return ["zcode-server.cjs"];
    case "node-runtime":
      return ["node", "LICENSE.node.txt", "NODE-SOURCES.json"];
    case "node-pty":
      return ["pty.node"];
    case "glm":
      return [
        "zcode.cjs",
        ...BUILTIN_PLUGIN_REQUIRED_PATHS.map((path) => `packages/${path}`),
        "packages/bundled-skills/skills/dynamic-workflows/SKILL.md",
        "packages/bundled-skills/skills/dynamic-workflows/patterns.md",
        "packages/bundled-skills/skills/dynamic-workflows/examples.md",
      ];
    case "bfs":
      return ["bfs"];
    case "ripgrep":
      return ["rg"];
    case "ugrep":
      return ["ugrep"];
    default:
      throw new Error(`Unknown remote component: ${id}`);
  }
}

const componentSchema = z
  .object({
    id: z.enum(ACTIVE_REMOTE_RESOURCE_PACKAGE_IDS),
    version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    artifactPath: z.string(),
    mount: z.string(),
    requiredPaths: z.array(z.string()).optional(),
  })
  .transform((component) => {
    const requiredPaths = remoteComponentRequiredPaths(component.id);
    if (
      component.requiredPaths &&
      JSON.stringify(component.requiredPaths) !== JSON.stringify(requiredPaths)
    ) {
      throw new Error(`Component required paths mismatch: ${component.id}`);
    }
    return { ...component, requiredPaths };
  });

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceDirty: z.boolean().default(false),
  platformArch: z.literal(BUNDLED_REMOTE_PLATFORM),
  components: z.array(componentSchema).length(ACTIVE_REMOTE_RESOURCE_PACKAGE_IDS.length),
});

export type BundledRemoteManifest = z.infer<typeof manifestSchema>;

/** The installed application owns this manifest; network and old caches cannot amend it. */
export function parseBundledRemoteManifest(
  value: unknown,
  appVersion: string,
): BundledRemoteManifest {
  const manifest = manifestSchema.parse(value);
  if (manifest.appVersion !== appVersion) throw new Error("Bundled remote appVersion mismatch");
  const seen = new Set<string>();
  for (const component of manifest.components) {
    if (seen.has(component.id)) throw new Error(`Duplicate remote component: ${component.id}`);
    seen.add(component.id);
    if (component.mount !== mounts[component.id])
      throw new Error(`Invalid component mount: ${component.id}`);
    const prefix = `components/${BUNDLED_REMOTE_PLATFORM}/${component.id}/`;
    const filename = component.artifactPath.slice(prefix.length);
    if (
      !component.artifactPath.startsWith(prefix) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*\.tar\.gz$/.test(filename)
    ) {
      throw new Error(`Invalid component archive path: ${component.id}`);
    }
    // 同一语义版本也可能重新构建；必须使用当前归档内容身份。
    if (!component.version.endsWith(`+${component.sha256.slice(0, 12)}`)) {
      throw new Error(`Component content identity mismatch: ${component.id}`);
    }
  }
  return manifest;
}
