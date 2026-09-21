/**
 * 清单哈希、状态文件与增量计算。
 *
 * 状态字段名对齐闭源版 state.json，便于把两份文件并排 diff——那是这个工具
 * 主要的交付物形态。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { canonicalJson } from "./vault.js";
import {
  PARODY_SCHEMA,
  type ManifestFile,
  type PendingUploadRecord,
  type RepoSnapshotManifest,
  type RepoSnapshotState,
  type SnapshotDelta,
} from "./types.js";

/** 只对结构与内容敏感，不对 createdAt / source 敏感——否则每次扫描哈希都变。 */
export function canonicalizeManifestForHash(manifest: RepoSnapshotManifest) {
  return {
    schema: PARODY_SCHEMA,
    workspaceKey: manifest.workspaceKey,
    files: [...manifest.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })),
  };
}

export function computeManifestHash(manifest: RepoSnapshotManifest): string {
  return createHash("sha256").update(canonicalJson(canonicalizeManifestForHash(manifest))).digest("hex");
}

export function buildDelta(input: {
  baseManifest: RepoSnapshotManifest;
  nextManifest: RepoSnapshotManifest;
  baseManifestHash: string;
  nextManifestHash: string;
}): SnapshotDelta {
  const baseByPath = new Map(input.baseManifest.files.map((file) => [file.path, file]));
  const nextByPath = new Map(input.nextManifest.files.map((file) => [file.path, file]));

  const addedOrModified: ManifestFile[] = [];
  for (const file of input.nextManifest.files) {
    const previous = baseByPath.get(file.path);
    if (!previous || previous.sizeBytes !== file.sizeBytes) {
      addedOrModified.push({ path: file.path, sizeBytes: file.sizeBytes });
    }
  }

  const deleted: string[] = [];
  for (const file of input.baseManifest.files) {
    if (!nextByPath.has(file.path)) deleted.push(file.path);
  }

  addedOrModified.sort((left, right) => left.path.localeCompare(right.path));
  deleted.sort((left, right) => left.localeCompare(right));

  return {
    schema: PARODY_SCHEMA,
    baseManifestHash: input.baseManifestHash,
    nextManifestHash: input.nextManifestHash,
    addedOrModified,
    deleted,
  };
}

const DEFAULT_STATE: Omit<RepoSnapshotState, "workspacePath" | "workspaceKey"> = {
  failureCount: 0,
};

export function statePathFor(workspacesRoot: string, workspaceKeyHash: string): string {
  return join(workspacesRoot, workspaceKeyHash, "state.json");
}

export function manifestPathFor(
  workspacesRoot: string,
  workspaceKeyHash: string,
  manifestHash: string,
): string {
  return join(workspacesRoot, workspaceKeyHash, "manifests", `${manifestHash}.json`);
}

export async function readState(path: string, workspacePath: string, workspaceKey: string): Promise<RepoSnapshotState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoSnapshotState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      workspacePath,
      workspaceKey,
      failureCount: typeof parsed.failureCount === "number" ? parsed.failureCount : 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_STATE, workspacePath, workspaceKey };
    }
    throw error;
  }
}

export async function writeState(path: string, state: RepoSnapshotState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

export async function readManifest(path: string): Promise<RepoSnapshotManifest> {
  return JSON.parse(await readFile(path, "utf8")) as RepoSnapshotManifest;
}

export async function writeManifest(path: string, manifest: RepoSnapshotManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function sanitizePendingUpload(record: PendingUploadRecord | undefined): PendingUploadRecord | undefined {
  if (!record) return undefined;
  return {
    ...record,
    attemptCount: typeof record.attemptCount === "number" ? record.attemptCount : 0,
  };
}

export function normalizeState(state: RepoSnapshotState): RepoSnapshotState {
  const active = sanitizePendingUpload(state.activeUpload);
  const latest = sanitizePendingUpload(state.latestPendingUpload);
  return {
    ...state,
    failureCount: Number.isFinite(state.failureCount) ? Math.max(0, Math.floor(state.failureCount)) : 0,
    activeUpload: active,
    latestPendingUpload: latest,
  };
}
