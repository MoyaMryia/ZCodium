// ============================================================
// Tool Registry - Tool registration and lookup
// ============================================================

import { type ModelToolContract } from "@zcode/contracts";
import type { ToolEntry, ToolMetadata } from "./types.js";

// -----------------------------------------------
// Tool Registry Interface
// -----------------------------------------------

export interface ToolRegistry {
  register(entry: ToolEntry, options?: ToolRegistryRegisterOptions): void;
  unregister(name: string): void;
  get(name: string): ToolEntry | undefined;
  has(name: string): boolean;
  list(): string[];
  getMetadata(name: string): ToolMetadata | undefined;
  toContracts(): ModelToolContract[];
}

export interface ToolRegistryRegisterOptions {
  silentDuplicateWarning?: boolean;
}

// -----------------------------------------------
// Tool Registry Implementation
// -----------------------------------------------

export class ToolRegistryImpl implements ToolRegistry {
  private aliases = new Map<string, string>();
  private tools = new Map<string, ToolEntry>();

  register(entry: ToolEntry, options: ToolRegistryRegisterOptions = {}): void {
    const displacedAliasTarget = this.aliases.get(entry.metadata.name);
    if (displacedAliasTarget) {
      // 查找时 alias 若优先于 canonical，后注册的真实同名工具会继续被旧
      // alias 遮蔽。canonical 始终优先，并留下告警，避免兼容别名改变工具身份。
      this.aliases.delete(entry.metadata.name);
      if (options.silentDuplicateWarning !== true) {
        console.warn("Tool registration replaced a conflicting alias");
      }
    }
    if (this.tools.has(entry.metadata.name) && options.silentDuplicateWarning !== true) {
      console.warn("Tool registration replaced an existing tool");
    }
    for (const [alias, target] of this.aliases) {
      if (target === entry.metadata.name) {
        this.aliases.delete(alias);
      }
    }
    this.tools.set(entry.metadata.name, entry);
    for (const alias of entry.aliases ?? []) {
      const existingAliasTarget = this.aliases.get(alias);
      if (
        alias === entry.metadata.name ||
        this.tools.has(alias) ||
        (existingAliasTarget !== undefined && existingAliasTarget !== entry.metadata.name)
      ) {
        // 兼容 alias 若静默覆盖 canonical/另一个 alias，会把一次工具调用路由到
        // 错误权限和 handler。冲突时拒绝本 alias，保留已注册身份。
        if (options.silentDuplicateWarning !== true) {
          console.warn("Tool alias conflicts with an existing registration; skipping");
        }
        continue;
      }
      this.aliases.set(alias, entry.metadata.name);
    }
  }

  unregister(name: string): void {
    const aliasTarget = this.aliases.get(name);
    if (aliasTarget) {
      this.aliases.delete(name);
      return;
    }

    this.tools.delete(name);
    for (const [alias, target] of this.aliases) {
      if (target === name) {
        this.aliases.delete(alias);
      }
    }
  }

  get(name: string): ToolEntry | undefined {
    return this.tools.get(this.aliases.get(name) ?? name);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  getMetadata(name: string): ToolMetadata | undefined {
    return this.get(name)?.metadata;
  }

  toContracts(): ModelToolContract[] {
    return Array.from(this.tools.values())
      .filter((entry) => entry.metadata.providerVisible !== false)
      .map((entry) => ({
        name: entry.metadata.name,
        description: toolDescriptionForProvider(entry.metadata),
        capability: entry.capability,
        executionMode: entry.executionMode,
        providerNative: entry.providerNative,
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        ...(entry.strict === undefined ? {} : { strict: entry.strict }),
        readOnly: entry.metadata.readOnly,
        destructive: entry.metadata.destructive,
        concurrentSafe: entry.metadata.concurrentSafe,
        requiresUserInteraction:
          entry.requiresUserInteraction ?? entry.metadata.requiresUserInteraction,
        maxOutputBytes: entry.metadata.maxOutputBytes,
        timeoutMs: entry.metadata.timeoutMs,
        needsApproval: entry.metadata.needsApproval,
        sideEffectScope: entry.metadata.sideEffectScope,
        permission: entry.permission,
        resultBudget: entry.resultBudget,
        execute: undefined,
      }));
  }
}

function toolDescriptionForProvider(metadata: ToolMetadata): string | undefined {
  const description = metadata.description;
  const instructions = metadata.modelInstructions?.map((line) => line.trim()).filter(Boolean) ?? [];
  if (instructions.length === 0) return description;

  const usage = ["Usage:", ...instructions.map((instruction) => `- ${instruction}`)].join("\n");
  return description && description.length > 0 ? `${description}\n\n${usage}` : usage;
}

// -----------------------------------------------
// Factory
// -----------------------------------------------

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistryImpl();
}
