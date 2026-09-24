import { cp, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  CUA_RUNTIME_MODULES_PATH,
  cuaNativePackage,
  cuaRuntimeRequiredPaths,
} from "@zcode/shared/builtin-plugin-assets";

const repositoryRoot = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/** Build-time only: preserve the SDK's native loader and standard npm resolution. */
export async function stageCuaDriverRuntime(pluginRoot, options = {}) {
  await stageCuaDriverRuntimeFiles(join(pluginRoot, dirname(CUA_RUNTIME_MODULES_PATH)), options);
}

export async function stageCuaDriverRuntimeFiles(
  mcpDirectory,
  {
    platform = process.platform,
    arch = process.arch,
    sourceModules = join(repositoryRoot, "node_modules"),
  } = {},
) {
  const native = cuaNativePackage(platform, arch);
  const expected = (await readJson(join(repositoryRoot, "packages/zcode-cua/package.json")))
    .dependencies["@trycua/cua-driver"];
  const sdk = await readJson(join(sourceModules, "@trycua/cua-driver/package.json"));
  const packages = new Map([
    ["@trycua/cua-driver", expected],
    [native, expected],
    ["@ubjs/core", sdk.dependencies["@ubjs/core"]],
    ["@ubjs/node", sdk.dependencies["@ubjs/node"]],
  ]);
  // 修复：原 bundle 内联 SDK 后丢失原生包定位。构建显式保留包边界，缺包禁止靠开发目录兜底。
  for (const [name, version] of packages) {
    const manifest = await readJson(join(sourceModules, name, "package.json"));
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`CUA runtime version mismatch: ${name}, expected ${version}`);
    }
  }
  const modules = join(mcpDirectory, "node_modules");
  // 交叉打包必须清理上一个目标的原生库，不能把构建机平台带入安装包。
  await rm(modules, { recursive: true, force: true });
  for (const name of packages.keys()) {
    const source = join(sourceModules, name);
    await cp(source, join(modules, name), {
      recursive: true,
      dereference: true,
      filter: (path) => path === source || basename(path) !== "node_modules",
    });
  }
  await cp(
    join(repositoryRoot, "third-party/cua-driver/NOTICE.md"),
    join(mcpDirectory, "CUA-NOTICES.md"),
  );
  await validateCuaDriverRuntimeFiles(mcpDirectory, { platform, arch });
}

export async function validateCuaDriverRuntime(pluginRoot, target) {
  await validateCuaDriverRuntimeFiles(join(pluginRoot, dirname(CUA_RUNTIME_MODULES_PATH)), target);
}

async function validateCuaDriverRuntimeFiles(mcpDirectory, { platform, arch }) {
  for (const path of cuaRuntimeRequiredPaths(platform, arch)) {
    const entry = await stat(
      join(mcpDirectory, relative(dirname(CUA_RUNTIME_MODULES_PATH), path)),
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry?.isFile() || !entry.size) throw new Error(`Missing CUA runtime asset: ${path}`);
  }
}
