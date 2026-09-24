export interface ComputerUseRuntimeContext {
  sessionId: string;
  runtimeScope: "main" | "subagent";
  workspaceKey: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: "web-remote-replayable" | "desktop-continuous";
  deliveryKind?: "web-remote-replayable" | "desktop-continuous";
  trace?: Record<string, unknown>;
}

export interface ComputerUseRuntimeExecuteInput {
  toolName: string;
  arguments?: unknown;
  context: ComputerUseRuntimeContext;
  signal?: AbortSignal;
}

export interface ComputerUseRuntime {
  execute(input: ComputerUseRuntimeExecuteInput): Promise<unknown>;
  closeSession(context: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * 兼容层执行器（老 GNOME / Wayland）。只接管输入类工具；
 * 观察与语义仍由 cua-driver 处理。契约见 `computer-use-wayland-input.md` §8。
 */
export interface ComputerUseCompatExecutor {
  applies: boolean;
  execute(input: ComputerUseRuntimeExecuteInput): Promise<unknown>;
  dispose?(): void | Promise<void>;
}

/** cua-driver 的图片块（TS SDK 用 base64 字符串）。 */
export interface CuaDriverImageContent {
  mimeType: string;
  dataBase64: string;
}

/**
 * cua-driver `ToolResult` 中适配器读取的字段。
 *
 * 其余类型化字段（`action` / `verification`）可能包含 bigint，只经 `rawJson` 透传。
 */
export interface CuaDriverToolResult {
  text: string;
  images?: CuaDriverImageContent[];
  structuredJson?: string;
  isError: boolean;
  errorCode?: string;
  degraded: boolean;
  rawJson: string;
}

export interface CuaDriverCallOptions {
  signal?: AbortSignal;
}

/**
 * 原生执行端的端口。`@trycua/cua-driver` 的 `CuaDriver`、daemon connect
 * 与 MCP proxy client 都实现它；测试用假 client 实现同一端口。
 */
export interface CuaDriverClient {
  callTool(
    name: string,
    argumentsJson: string,
    options?: CuaDriverCallOptions,
  ): Promise<CuaDriverToolResult>;
  endSession?(): Promise<unknown>;
  dispose?(): Promise<void>;
}

export interface ComputerUseRuntimeOptions {
  /** 注入的 driver client。缺失时运行时 fail-closed。 */
  client?: CuaDriverClient;
  /** 兼容层执行器（老 GNOME）。`applies` 为真且工具属输入类时接管。 */
  compat?: ComputerUseCompatExecutor;
  /** client 缺失时展示给调用方的原因。 */
  unavailableReason?: string;
  /** 兼容旧装配点；本次改造后未使用。 */
  brokerSocketPath?: string;
  /** 兼容旧装配点；本次改造后未使用。 */
  refreshMarkerPath?: string;
  env?: Record<string, string | undefined>;
}

export declare const UNAVAILABLE_TEXT: string;

export declare function assertCuaDriverClient(client: unknown): string | undefined;

export declare function createUnavailableRuntime(reason?: string): ComputerUseRuntime;

export declare function createCuaDriverRuntime(
  client: CuaDriverClient,
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;

export declare function projectToolResult(result: CuaDriverToolResult): unknown;

export declare function projectDriverError(toolName: string, error: unknown): unknown;

export declare function createComputerUseRuntime(
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;
