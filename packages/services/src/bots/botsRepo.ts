// 桥接配置/绑定的唯一持久化入口。见 .agents/specs/bots-astrbot-bridge.md。
//
// 并发：同一路径的读写通过 promise 链串行，避免 read-modify-write 互相覆盖。
// 落盘：临时文件 + rename 原子替换，文件权限 0600。

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ServiceLogger } from "#src/logger/serviceLogger.js";
import {
  botsBindingsSchema,
  botsBridgeConfigSchema,
  createDefaultBotsBindings,
  createDefaultBotsBridgeConfig,
  type BotsBindings,
  type BotsBridgeConfig,
} from "./domain.js";

const CONFIG_FILE_NAME = "bots-bridge.v2.json";
const BINDINGS_FILE_NAME = "bots-bindings.v2.json";
const FILE_MODE = 0o600;

export interface BotsRepoOptions {
  dir: string;
  logger: ServiceLogger;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(
    dirname(filePath),
    `${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(tempPath, content, { encoding: "utf-8", mode: FILE_MODE });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export class BotsRepo {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: BotsRepoOptions) {}

  get configPath(): string {
    return join(this.options.dir, CONFIG_FILE_NAME);
  }

  get bindingsPath(): string {
    return join(this.options.dir, BINDINGS_FILE_NAME);
  }

  async readConfig(): Promise<BotsBridgeConfig> {
    return this.withLock(this.configPath, async () => {
      const raw = await readOptionalJson(this.configPath);
      if (raw === undefined) {
        return createDefaultBotsBridgeConfig();
      }
      const parsed = botsBridgeConfigSchema.safeParse(raw);
      if (!parsed.success) {
        // 损坏配置不能当成空配置后继续写入，否则会覆盖同一目录下的其他状态。
        this.options.logger.error(
          undefined,
          `read bot bridge config failed path=${this.configPath}: ${parsed.error.message}`,
        );
        throw new Error(`Invalid bot bridge config at ${this.configPath}`);
      }
      return parsed.data;
    });
  }

  async writeConfig(config: BotsBridgeConfig): Promise<BotsBridgeConfig> {
    const validated = botsBridgeConfigSchema.parse(config);
    return this.withLock(this.configPath, async () => {
      await writeTextAtomic(this.configPath, `${JSON.stringify(validated, null, 2)}\n`);
      return validated;
    });
  }

  async readBindings(): Promise<BotsBindings> {
    return this.withLock(this.bindingsPath, async () => {
      const raw = await readOptionalJson(this.bindingsPath);
      if (raw === undefined) {
        return createDefaultBotsBindings();
      }
      const parsed = botsBindingsSchema.safeParse(raw);
      if (!parsed.success) {
        this.options.logger.error(
          undefined,
          `read bot bindings failed path=${this.bindingsPath}: ${parsed.error.message}`,
        );
        throw new Error(`Invalid bot bindings at ${this.bindingsPath}`);
      }
      return parsed.data;
    });
  }

  async writeBindings(bindings: BotsBindings): Promise<BotsBindings> {
    const validated = botsBindingsSchema.parse(bindings);
    return this.withLock(this.bindingsPath, async () => {
      await writeTextAtomic(this.bindingsPath, `${JSON.stringify(validated, null, 2)}\n`);
      return validated;
    });
  }

  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.locks.set(
      key,
      next.catch(() => {
        // 锁链只需要保持顺序，失败由调用方处理。
      }),
    );
    return next;
  }
}
