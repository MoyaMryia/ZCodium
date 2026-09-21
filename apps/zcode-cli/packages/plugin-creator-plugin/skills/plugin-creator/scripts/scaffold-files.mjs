/**
 * 生成脚手架文件。
 *
 * 只生成**已声明**的组件：manifest 里出现一个目录，loader 就会去找它，生成一堆没人用
 * 的空目录只会让插件看起来比实际大。模板里的 `${CLAUDE_PLUGIN_ROOT}` 由 loader 在运行
 * 时替换，所以这里不做任何路径推断。
 */

/** 每个组件对应「manifest 字段 + 该产的文件」。新增组件只需在这张表里加一行。 */
const COMPONENT_OUTPUTS = {
  skills: {
    manifestField: "skills",
    files: (name) => [
      [
        `skills/${name}/SKILL.md`,
        `---\nname: ${name}\ndescription: Guide the ${name} workflow when the user explicitly requests this plugin.\n---\n\n# ${name}\n\nClarify the requested outcome, inspect the available inputs, and agree on the concrete implementation before executing the workflow.\n`,
      ],
    ],
  },
  commands: {
    manifestField: "commands",
    files: (name) => [
      [
        "commands/help.md",
        `---\ndescription: Explain the ${name} plugin workflow\n---\n\nRead this plugin's README and explain its available capabilities.\n`,
      ],
    ],
  },
  hooks: {
    manifestField: "hooks",
    files: () => [
      [
        "hooks/hooks.json",
        jsonFile({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"' }] },
            ],
          },
        }),
      ],
      // 默认无副作用：启动钩子一有输出就会被塞进每个会话的上下文，
      // 所以骨架里先什么都不做，等行为明确了再写。
      ["scripts/session-start.mjs", "// 启动钩子默认无副作用；实现明确的插件行为后再输出上下文。\n"],
    ],
  },
  mcp: {
    manifestField: "mcpServers",
    files: (name) => [
      [
        ".mcp.json",
        jsonFile({
          mcpServers: {
            [name]: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs"] },
          },
        }),
      ],
      ["scripts/mcp-server.mjs", mcpServerSkeleton(name)],
    ],
  },
};

/** 只占位、不含真实实现的目录。用户声明了才建。 */
const PLACEHOLDER_DIRECTORIES = ["scripts", "assets"];

function jsonFile(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/**
 * 最小 MCP 骨架。
 *
 * 只实现握手、空工具列表和 ping。`initialize` 必须回显客户端请求的 protocolVersion，
 * 否则握手失败；tools 则必须等真实工具实现后再加——返回一个空列表会让调用方以为
 * 「服务通了但没有工具」，而那正是最难排查的一种状态。
 */
function mcpServerSkeleton(name) {
  return `import { createInterface } from "node:readline";
// 最小 MCP 握手骨架；只在实现真实工具后扩展 tools/list 和 tools/call。
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  const result = message.method === "initialize"
    ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: ${JSON.stringify(name)}, version: "0.1.0" } }
    : message.method === "tools/list" ? { tools: [] } : message.method === "ping" ? {} : undefined;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...(result ? { result } : { error: { code: -32601, message: "Method not found" } }) }) + "\\n");
}
`;
}

/**
 * manifest 里组件字段的固定书写顺序。
 *
 * 按组件名遍历会让字段顺序随 `--with-*` 的传入顺序变化，生成的 manifest 每次都长得不
 * 一样——那会让「插件源码没变」的 diff 判断失效，也会让重复生成的插件产生无意义 diff。
 */
const MANIFEST_FIELD_ORDER = ["skills", "commands", "hooks", "mcpServers"];

export function scaffoldFiles(name, components) {
  const manifest = {
    name,
    version: "0.1.0",
    description: `${name} plugin`,
    author: { name: "Local developer" },
  };
  const files = new Map();

  files.set(
    "README.md",
    `# ${name}\n\nDescribe this plugin's workflow and required configuration here.\n\nValidate before installation: \`zcode plugins validate .\`.\n`,
  );

  for (const field of MANIFEST_FIELD_ORDER) {
    const component = MANIFEST_FIELD_TO_COMPONENT[field];
    if (!component || !components.includes(component)) continue;
    // 按规范顺序产出文件，而不是按调用方传入的顺序：否则同一组组件用不同
    // --with-* 顺序会生成内容相同但文件顺序不同的插件。
    for (const [file, contents] of COMPONENT_OUTPUTS[component].files(name)) {
      files.set(file, contents);
    }
  }
  for (const field of MANIFEST_FIELD_ORDER) {
    const component = MANIFEST_FIELD_TO_COMPONENT[field];
    if (component && components.includes(component)) manifest[field] = manifestFieldPath(field);
  }

  for (const directory of PLACEHOLDER_DIRECTORIES) {
    if (components.includes(directory)) files.set(`${directory}/.gitkeep`, "");
  }

  files.set(".zcode-plugin/plugin.json", jsonFile(manifest));
  return files;
}

/** manifest 字段 → 提供它的组件名。 */
const MANIFEST_FIELD_TO_COMPONENT = {
  skills: "skills",
  commands: "commands",
  hooks: "hooks",
  mcpServers: "mcp",
};

/** manifest 里指向各组件的相对路径。统一 `./` 前缀，避免各写各的。 */
function manifestFieldPath(field) {
  if (field === "skills" || field === "commands") return `./${field}`;
  if (field === "hooks") return "./hooks/hooks.json";
  return "./.mcp.json";
}
