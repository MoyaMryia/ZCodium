import { extractDisallowedToolsArgs, parseGlobalArgs } from "./arguments.js";

interface TuiStderrInterceptor {
  readonly passthrough: NodeJS.WriteStream;
  restore(): void;
}

export function isTuiInvocation(argv: readonly string[]): boolean {
  let parsed: ReturnType<typeof parseGlobalArgs>;

  try {
    // 与 run 共享参数定义，包括 locale/browser/force-mcs 和多值工具限制。
    parsed = parseGlobalArgs(extractDisallowedToolsArgs(argv).args);
  } catch {
    return false;
  }

  if (
    parsed.values.help === true ||
    parsed.values.version === true ||
    typeof parsed.values.prompt === "string" ||
    typeof parsed.values.target === "string"
  ) {
    return false;
  }

  return (parsed.positionals[0] ?? "tui") === "tui";
}

export function interceptTuiStderr(stderr: NodeJS.WriteStream): TuiStderrInterceptor {
  const originalWrite = stderr.write;
  let restored = false;
  const passthrough = Object.create(stderr) as NodeJS.WriteStream;
  type WriteCallback = (err?: Error | null) => void;

  const writeOriginal = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    if (typeof encodingOrCallback === "function") {
      return originalWrite.call(stderr, chunk, undefined, encodingOrCallback);
    }

    if (typeof encodingOrCallback === "string") {
      return originalWrite.call(stderr, chunk, encodingOrCallback, callback);
    }

    return originalWrite.call(stderr, chunk);
  };

  passthrough.write = writeOriginal as NodeJS.WriteStream["write"];

  // TUI owns the full terminal. Raw stderr emitted during startup, including
  // Node runtime warnings from static imports, corrupts the screen.
  stderr.write = ((chunk, encodingOrCallback, callback) => {
    // 该旁路没有业务消费者，不能把第三方 stderr 原文作为隐私诊断缓存。
    const writeCallback = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (writeCallback) queueMicrotask(() => writeCallback());

    return true;
  }) as NodeJS.WriteStream["write"];

  return {
    passthrough,
    restore() {
      if (restored) return;
      restored = true;
      stderr.write = originalWrite;
    },
  };
}
