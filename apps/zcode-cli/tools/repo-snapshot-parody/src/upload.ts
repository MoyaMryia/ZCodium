/**
 * 上传：multipart POST 到 127.0.0.1。
 *
 * 表单字段名刻意模仿闭源版的阿里云 OSS 直传（key / policy / callback /
 * success_action_status），把两份表单并排放在一起就是这个工具想说的话。
 * OSS 的 STS 签名字段在此不适用，直接省略——本地没有签名门槛，也不需要。
 */

import { createReadStream } from "node:fs";
import { basename } from "node:path";
import type { EncryptionEnvelope } from "./types.js";
import { assertLoopbackTarget } from "./gate.js";

export interface UploadInput {
  readonly baseUrl: string;
  readonly workspaceKeyHash: string;
  readonly groupId: string;
  readonly encryptedArtifactPath: string;
  readonly envelope: EncryptionEnvelope;
  readonly manifest: unknown;
  readonly artifactBytes: number;
}

export interface UploadResult {
  readonly ok: boolean;
  readonly status: number;
  readonly responseBody: string;
}

function field(name: string, value: string, boundary: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  );
}

function fileHeader(name: string, filename: string, boundary: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
}

async function readArtifact(path: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(Buffer.concat(chunks)));
  });
}

export async function uploadSnapshot(input: UploadInput): Promise<UploadResult> {
  const url = assertLoopbackTarget(`${input.baseUrl.replace(/\/+$/u, "")}/snapshot`);

  const boundary = `----zcode-repo-snapshot-parody-${input.groupId}`;
  const objectKey = `parody/${input.workspaceKeyHash}/${input.groupId}.tar.gz.enc`;
  // 保留原版的 callback 形状，指向本地
  const callback = Buffer.from(
    JSON.stringify({
      callbackUrl: `${url.origin}/snapshot/callback`,
      callbackBody: JSON.stringify({ key: objectKey, keyId: input.envelope.keyId }),
      callbackBodyType: "application/json",
    }),
    "utf8",
  ).toString("base64");

  const parts: Buffer[] = [
    field("key", objectKey, boundary),
    field("success_action_status", "200", boundary),
    field("callback", callback, boundary),
    field("envelope", JSON.stringify(input.envelope), boundary),
    field("manifest", JSON.stringify(input.manifest), boundary),
    field("artifact_bytes", String(input.artifactBytes), boundary),
    fileHeader("file", basename(input.encryptedArtifactPath), boundary),
    await readArtifact(input.encryptedArtifactPath),
    Buffer.from("\r\n", "utf8"),
    Buffer.from(`--${boundary}--\r\n`, "utf8"),
  ];
  const requestBody = Buffer.concat(parts);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(requestBody.byteLength),
    },
    body: requestBody,
  });

  return {
    ok: response.ok,
    status: response.status,
    responseBody: (await response.text()).slice(0, 2000),
  };
}
