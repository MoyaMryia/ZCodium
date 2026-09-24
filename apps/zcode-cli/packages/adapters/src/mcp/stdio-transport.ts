import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import type { ChildProcess } from "node:child_process";
import { terminateMcpStdioProcessTree } from "./process-tree.js";
import {
  attachProcessToWindowsJobObject,
  type WindowsJobObjectController,
} from "./windows-job-object.js";

type SdkStdioDispose = (this: StdioClientTransport) => Promise<void>;

const sdkDispose = Object.getOwnPropertyDescriptor(StdioClientTransport.prototype, "_dispose")
  ?.value as SdkStdioDispose | undefined;

interface StdioProcessExitInfo {
  exitCode: number | null;
  exitedAt: number;
  signal: NodeJS.Signals | null;
  startedAt: number;
}

interface ProcessTreeStdioClientTransportOptions {
  windowsJobObjectFactory?: (pid: number) => Promise<WindowsJobObjectController | undefined>;
}

/**
 * SDK 2.0 会为 stdio 版本探测创建一次性兄弟进程，但其私有回收钩子只终止直接子进程。
 * launcher/watchdog 派生的后代会因此变成孤儿；在同一个钩子里先回收整棵进程树，再让
 * SDK 清理 pipe 和读取缓冲区。原型上必须直接拥有 `_dispose`，SDK 才会把该 transport
 * 识别为可安全克隆的探测 transport。
 */
export class ProcessTreeStdioClientTransport extends StdioClientTransport {
  private childProcess?: ChildProcess;
  private lastProcessExit?: StdioProcessExitInfo;
  private readonly windowsJobObjectFactory: (
    pid: number,
  ) => Promise<WindowsJobObjectController | undefined>;
  private windowsJobObject?: WindowsJobObjectController;

  constructor(server: StdioServerParameters, options: ProcessTreeStdioClientTransportOptions = {}) {
    super(server);
    this.windowsJobObjectFactory =
      options.windowsJobObjectFactory ?? attachProcessToWindowsJobObject;
  }

  async terminateWindowsJobObject(): Promise<void> {
    const windowsJobObject = this.windowsJobObject;
    this.windowsJobObject = undefined;
    if (!windowsJobObject) return;
    try {
      windowsJobObject.terminate();
    } catch {
      // 继续执行 close 与 taskkill 回退。
    } finally {
      try {
        windowsJobObject.close();
      } catch {
        // 句柄关闭失败不能阻断 SDK pipe 清理。
      }
    }
  }

  override async start(): Promise<void> {
    const startedAt = Date.now();
    await super.start();
    const child = (this as unknown as { _process?: ChildProcess })._process;
    if (!child) return;
    this.childProcess = child;
    const recordExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      this.lastProcessExit ??= {
        exitCode,
        exitedAt: Date.now(),
        signal,
        startedAt,
      };
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      recordExit(child.exitCode, child.signalCode);
      return;
    }
    child.once("exit", recordExit);

    // staging 曾把 Job Object 接管和退出观测各自合入成两个同名 start()，导致 CLI
    // 构建直接报 Duplicate function implementation；这里合并两个职责，保留 Windows
    // 进程树托管和跨平台退出记录。
    if (process.platform !== "win32" || this.pid == null) return;
    try {
      this.windowsJobObject = await this.windowsJobObjectFactory(this.pid);
    } catch {
      // 原生托管不可用时保留 taskkill 回退，不能让 MCP 建连因可选能力失败。
      this.windowsJobObject = undefined;
    }
  }

  get processExit(): StdioProcessExitInfo | undefined {
    return this.lastProcessExit;
  }

  get processAlive(): boolean {
    return Boolean(
      this.childProcess &&
      this.childProcess.exitCode === null &&
      this.childProcess.signalCode === null,
    );
  }
}

Object.defineProperty(ProcessTreeStdioClientTransport.prototype, "_dispose", {
  configurable: true,
  async value(this: ProcessTreeStdioClientTransport): Promise<void> {
    const pid = this.pid;
    await this.terminateWindowsJobObject();
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
      try {
        await terminateMcpStdioProcessTree(pid);
      } catch {
        // SDK 的探测回收本来就是 best effort；仍需继续释放 pipe，避免协商永久卡住。
      }
    }

    if (sdkDispose) {
      await sdkDispose.call(this);
      return;
    }
    await this.close();
  },
});
