import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseToolchain(source, packageManager) {
  const tools = source.match(/^\[tools\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const readVersion = (name) => {
    const version = tools?.match(
      new RegExp(`^${name}\\s*=\\s*"([0-9]+\\.[0-9]+\\.[0-9]+)"\\s*$`, "m"),
    )?.[1];
    if (!version) throw new Error(`Missing pinned ${name} version in mise.toml [tools]`);
    return version;
  };
  const node = readVersion("node");
  const pnpm = readVersion("pnpm");
  if (packageManager !== `pnpm@${pnpm}`) throw new Error("mise.toml and packageManager disagree");
  return { node, pnpm };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { packageManager } = JSON.parse(await readFile("package.json", "utf8"));
  const versions = parseToolchain(await readFile("mise.toml", "utf8"), packageManager);
  // setup-node 的文件解析会把 TOML 首行当作版本；显式传入解析结果以避免下载 “[tools]”。
  await appendFile(process.env.GITHUB_OUTPUT, `node=${versions.node}\npnpm=${versions.pnpm}\n`);
}
