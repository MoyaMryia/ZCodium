import { safeLogArgs } from "@zcode/shared";
/**
 * 隐藏子命令 `__zcode-dwf-child <entry path>`：dynamic workflow 的沙箱子进程入口。
 *
 * 存在理由：SEA 单文件二进制**不解释 Node CLI 旗标**——harness 缺省的
 * `node --max-old-space-size=… <entry>` 里的旗标会原样落进 CLI 的严格 parseArgs，子进程立刻报错
 * 退出，于是 SEA 下每一个 workflow run 必然失败。修法与 official plugin host 同款
 * （`plugin-host-command.ts`）：SEA 下 bootstrap 让 harness 自 re-exec 本二进制并带上本子命令，
 * `run.ts` 在 parseArgs **之前**分派到这里。
 *
 * payload 不再走 argv（Windows 命令行上限
 * 32,767 字符），harness 写一份自包含的入口文件 `<cwd>/.zcode/workflow-runs/<runId>.mjs`，argv
 * 末位只是它的路径。入口文件自带 childMain 与 payload，这里只 `import()` 它并把 CLI 进程的
 * vm/readline/stdio 注入它导出的 `start`——本模块因此**不再依赖 `@zcode/dynamic-workflow-runtime`**。
 * 堆上限的 best-effort `v8.setFlagsFromString` 也随 payload 挪进了入口文件。
 */

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { ZCODE_DWF_CHILD_COMMAND } from "@zcode/contracts";
import type { RunContext } from "@zcode/shared-types";

export function isDwfChildInvocation(argv: readonly string[]): boolean {
  return argv[0] === ZCODE_DWF_CHILD_COMMAND;
}

/** 入口文件导出面（child-source.ts 的 `renderChildEntry` 生成）。 */
interface ChildEntryModule {
  start?: (deps: {
    vm: { createContext: typeof createContext; runInContext: typeof runInContext };
    createInterface: typeof createInterface;
    stdin: NodeJS.ReadableStream;
    stdout: { write(chunk: string): unknown };
  }) => Promise<void>;
}

/**
 * 跑沙箱子进程直到脚本终结。`argv` 是去掉子命令名后的剩余参数，**末位**是入口文件路径。
 *
 * 必须 await 到终结才返回：CLI 入口在 `run()` 返回后会挂 1s 退出 watchdog
 * （shutdown.ts 的 `scheduleCliExitWatchdog`），提前返回等于让 watchdog 在 run 刚起步时强退子进程。
 */
export async function runDwfChildCommand(ctx: RunContext, argv: string[]): Promise<number> {
  const entryPath = argv[argv.length - 1];
  if (argv.length === 0 || entryPath === undefined) {
    ctx.stderr.write(`Usage: ${ZCODE_DWF_CHILD_COMMAND} <entry path>\n`);
    return 1;
  }

  try {
    // 动态 import 一份磁盘上的 ESM（与 plugin-host-command.ts 加载插件入口同款）。入口文件
    // 自己判定「不是进程入口」（argv[1] 是子命令名，不是它），不会自启，由这里调 start。
    const entry = (await import(pathToFileURL(resolve(entryPath)).href)) as ChildEntryModule;
    if (typeof entry.start !== "function") {
      throw new Error(`workflow entry file exports no start(): ${entryPath}`);
    }
    await entry.start({
      vm: { createContext, runInContext },
      createInterface,
      stdin: ctx.stdin,
      stdout: ctx.stdout,
    });
    return 0;
  } catch (error) {
    // stdout 是父进程的 NDJSON 通道，诊断只能走 stderr——harness 正是以子进程 stderr 归因
    // 「退出而未完成」的失败（harness.ts 的 child.on("close")）。
    const message = JSON.stringify(safeLogArgs([error]));
    ctx.stderr.write(`Workflow child failed: ${message}\n`);
    return 1;
  }
}
