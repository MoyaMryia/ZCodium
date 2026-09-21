/**
 * 本地接收端。
 *
 * 它唯一的职责是**原样展示"服务端当时看到了什么"**：收到多少文件、多少字节、
 * 其中哪些来自 `.git`。这是整个工具的核心输出——不是扫描结果，是"对面收到的东西"。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLoopbackHost } from "./gate.js";
import type { EncryptionEnvelope, RepoSnapshotManifest } from "./types.js";

export interface ReceivedSnapshot {
  readonly key: string;
  readonly artifactBytes: number;
  readonly envelopeKeyId: string;
  readonly manifestFileCount: number;
  readonly manifestBytes: number;
  readonly gitInternalFileCount: number;
  readonly gitInternalBytes: number;
  readonly samplePaths: readonly string[];
  readonly receivedAt: number;
}

export interface SnapshotServer {
  readonly server: Server;
  readonly port: number;
  readonly received: readonly ReceivedSnapshot[];
  close(): Promise<void>;
}

interface ParsedPart {
  readonly name: string;
  readonly filename?: string;
  readonly body: Buffer;
}

/** 最小 multipart 解析：按 boundary 切段，段内按第一个空行分头部/体。 */
export function parseMultipart(body: Buffer, contentType: string): ParsedPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2])?.trim();
  if (!boundary) throw new Error("multipart 请求缺少 boundary");

  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  const parts: ParsedPart[] = [];
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) return parts;
  cursor += delimiter.length;

  while (cursor < body.length) {
    // 结束标记 "--boundary--"
    if (body.subarray(cursor, cursor + 2).toString("utf8") === "--") break;
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;

    const next = body.indexOf(delimiter, cursor);
    if (next < 0) break;
    const raw = body.subarray(cursor, next);
    const separator = raw.indexOf("\r\n\r\n");
    if (separator < 0) {
      cursor = next + delimiter.length;
      continue;
    }

    const headerText = raw.subarray(0, separator).toString("utf8");
    let partBody = raw.subarray(separator + 4);
    // 段尾的 CRLF 属于分隔符，不属于内容
    if (partBody.subarray(-2).toString("utf8") === "\r\n") {
      partBody = partBody.subarray(0, partBody.length - 2);
    }

    const nameMatch = /name="([^"]*)"/iu.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/iu.exec(headerText);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1] ?? "",
        ...(filenameMatch?.[1] !== undefined ? { filename: filenameMatch[1] } : {}),
        body: Buffer.from(partBody),
      });
    }
    cursor = next + delimiter.length;
  }

  return parts;
}

function summarize(manifest: RepoSnapshotManifest | undefined): {
  fileCount: number;
  bytes: number;
  gitFileCount: number;
  gitBytes: number;
  sample: string[];
} {
  if (!manifest) return { fileCount: 0, bytes: 0, gitFileCount: 0, gitBytes: 0, sample: [] };
  const git = manifest.files.filter((file) => file.path.split("/").includes(".git"));
  return {
    fileCount: manifest.stats.includedFileCount,
    bytes: manifest.stats.includedBytes,
    gitFileCount: git.length,
    gitBytes: git.reduce((sum, file) => sum + file.sizeBytes, 0),
    sample: manifest.files.slice(0, 12).map((file) => `${file.path} (${file.sizeBytes}B)`),
  };
}

export interface StartServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly storageDir: string;
  readonly log?: (message: string) => void;
}

export async function startSnapshotServer(options: StartServerOptions): Promise<SnapshotServer> {
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? ((message: string) => console.log(message));
  const received: ReceivedSnapshot[] = [];

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || !request.url?.startsWith("/snapshot")) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
      return;
    }
    if (!isLoopbackHost(request.socket.remoteAddress ?? "")) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("loopback only");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    const body = Buffer.concat(chunks);

    try {
      const parts = parseMultipart(body, request.headers["content-type"] ?? "");
      const byName = new Map(parts.map((part) => [part.name, part]));
      const artifact = byName.get("file");
      const envelopeRaw = byName.get("envelope")?.body.toString("utf8");
      const manifestRaw = byName.get("manifest")?.body.toString("utf8");

      if (!artifact || !envelopeRaw || !manifestRaw) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("missing file / envelope / manifest");
        return;
      }

      const envelope = JSON.parse(envelopeRaw) as EncryptionEnvelope;
      const manifest = JSON.parse(manifestRaw) as RepoSnapshotManifest;
      const key = byName.get("key")?.body.toString("utf8") ?? "unknown";
      const groupId = key.split("/").at(-1)?.replace(/\.tar\.gz\.enc$/u, "") ?? "unknown";

      const targetDir = join(options.storageDir, groupId);
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, "snapshot.tar.gz.enc"), artifact.body);
      await writeFile(join(targetDir, "envelope.json"), `${JSON.stringify(envelope, null, 2)}\n`);
      await writeFile(join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      const summary = summarize(manifest);
      const record: ReceivedSnapshot = {
        key,
        artifactBytes: artifact.body.length,
        envelopeKeyId: envelope.keyId,
        manifestFileCount: summary.fileCount,
        manifestBytes: summary.bytes,
        gitInternalFileCount: summary.gitFileCount,
        gitInternalBytes: summary.gitBytes,
        samplePaths: summary.sample,
        receivedAt: Date.now(),
      };
      received.push(record);

      log(`\n[收到] key=${key}`);
      log(`  密文 ${record.artifactBytes} 字节 | 清单 ${record.manifestFileCount} 个文件 / ${record.manifestBytes} 字节`);
      log(`  其中 .git：${record.gitInternalFileCount} 个文件 / ${record.gitInternalBytes} 字节`);
      log(`  信封 keyId=${record.envelopeKeyId}（私钥在收件方手里才有意义）`);
      log(`  前几个条目：`);
      for (const sample of record.samplePaths) log(`    ${sample}`);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, key }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(options.port ?? 0, host, () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  log(`[repo-snapshot-parody] 接收端 listening on http://${host}:${port}/snapshot`);

  return {
    server,
    port,
    received,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      }),
  };
}
