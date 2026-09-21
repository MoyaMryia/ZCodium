/**
 * 加密与解密——本工具与闭源版唯一的实质差异就在这一层。
 *
 * 闭源版：RSA 公钥由服务端随上传凭证下发，私钥只在云端。客户端产出的密文
 * 连自己都解不开，"加密"只保证服务端单方面能看。
 *
 * 这里：密钥对在**本地**生成，私钥落在用户自己的状态目录（0600）。
 * 信封结构、算法、`encryptedDataKey` 的编码与闭源版逐字段一致，
 * 差别只有私钥在谁手里——所以 `decrypt` 真能还原，而原版不能。
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
  privateDecrypt,
  type KeyObject,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { CaptureKind, EncryptionEnvelope } from "./types.js";
import { PARODY_SCHEMA } from "./types.js";

const CONTENT_ALGORITHM = "aes-256-ctr" as const;
const KEY_WRAP_ALGORITHM = "rsa-oaep-sha256" as const;
const NONCE_BYTES = 16;
const KEY_BYTES = 32;
const RSA_MODULUS_BITS = 3072;

const PRIVATE_KEY_FILE = "rsa-private.pem";
const PUBLIC_KEY_FILE = "rsa-public.pem";

/** 与闭源版同形的规范化 JSON：键排序、跳过 undefined。AAD 用它序列化。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface LocalVault {
  readonly keysDir: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
}

/** 取本地密钥对；不存在则生成。私钥 0600，公钥可读。 */
export async function openLocalVault(keysDir: string): Promise<LocalVault> {
  await mkdir(keysDir, { recursive: true });
  const privatePath = join(keysDir, PRIVATE_KEY_FILE);
  const publicPath = join(keysDir, PUBLIC_KEY_FILE);

  let privatePem: string;
  let publicPem: string;
  try {
    privatePem = await readFile(privatePath, "utf8");
    publicPem = await readFile(publicPath, "utf8");
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: RSA_MODULUS_BITS,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privatePem = privateKey;
    publicPem = publicKey;
    await writeFile(privatePath, privatePem, { mode: 0o600 });
    await chmod(privatePath, 0o600);
    await writeFile(publicPath, publicPem);
  }

  // keyId 用公钥指纹：信封里能看出"这次用的是哪把钥匙"。
  const keyObject = createPublicKey(publicPem);
  const der = keyObject.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(der).digest("hex").slice(0, 16);

  return { keysDir, keyId, publicKeyPem: publicPem };
}

export interface EncryptArchiveInput {
  readonly plaintextArchivePath: string;
  readonly encryptedArtifactPath: string;
  readonly envelopePath: string;
  readonly vault: LocalVault;
  readonly workspaceKeyHash: string;
  readonly kind: CaptureKind;
  readonly manifestHash: string;
  readonly baseManifestHash?: string;
}

export interface EncryptArchiveResult {
  readonly envelope: EncryptionEnvelope;
  readonly encryptedSizeBytes: number;
}

/** AES-256-CTR 加密内容，AES 密钥用本地 RSA 公钥包住写进信封。 */
export async function encryptArchive(input: EncryptArchiveInput): Promise<EncryptArchiveResult> {
  const contentKey = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);

  await mkdir(dirname(input.encryptedArtifactPath), { recursive: true });
  await mkdir(dirname(input.envelopePath), { recursive: true });

  const plaintextSha256 = await sha256File(input.plaintextArchivePath);

  const cipher = createCipheriv(CONTENT_ALGORITHM, contentKey, nonce);
  const output = createWriteStream(input.encryptedArtifactPath);
  // nonce 作为密文前缀，与闭源版一致（nonceEncoding: ciphertext-prefix-16-byte）
  output.write(nonce);
  await pipeline(createReadStream(input.plaintextArchivePath), cipher, output);

  const envelopeBase = {
    schema: PARODY_SCHEMA,
    workspaceKeyHash: input.workspaceKeyHash,
    kind: input.kind,
    manifestHash: input.manifestHash,
    ...(input.baseManifestHash ? { baseManifestHash: input.baseManifestHash } : {}),
    compression: "tar.gz" as const,
  };

  const envelope: EncryptionEnvelope = {
    schema: PARODY_SCHEMA,
    contentAlgorithm: CONTENT_ALGORITHM,
    keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
    keyId: input.vault.keyId,
    nonceEncoding: "ciphertext-prefix-16-byte",
    aadEncoding: "canonical-json-v1",
    aad: envelopeBase,
    encryptedDataKey: publicEncrypt(
      {
        key: input.vault.publicKeyPem,
        padding: 4, // RSA_PKCS1_OAEP_PADDING
        oaepHash: "sha256",
      },
      contentKey,
    ).toString("base64"),
    plaintextSha256,
  };

  await writeFile(input.envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  const blob = await openAsBlob(input.encryptedArtifactPath);

  return { envelope, encryptedSizeBytes: blob.size };
}

export interface DecryptArchiveInput {
  readonly envelopePath: string;
  readonly encryptedArtifactPath: string;
  readonly outputPath: string;
  readonly vault: LocalVault;
}

/** 用本地私钥解信封 → 解 AES-256-CTR → 落明文 tar.gz。 */
export async function decryptArchive(input: DecryptArchiveInput): Promise<void> {
  const envelope = JSON.parse(await readFile(input.envelopePath, "utf8")) as EncryptionEnvelope;
  if (envelope.keyWrapAlgorithm !== KEY_WRAP_ALGORITHM) {
    throw new Error(`不支持的密钥包裹算法：${envelope.keyWrapAlgorithm}`);
  }
  if (envelope.contentAlgorithm !== CONTENT_ALGORITHM) {
    throw new Error(`不支持的内容加密算法：${envelope.contentAlgorithm}`);
  }

  const privateKey = createPrivateKey(await readFile(join(input.vault.keysDir, PRIVATE_KEY_FILE), "utf8"));
  let contentKey: Buffer;
  try {
    contentKey = privateDecrypt(
      { key: privateKey, padding: 4, oaepHash: "sha256" },
      Buffer.from(envelope.encryptedDataKey, "base64"),
    );
  } catch {
    // 密钥对不上时只说结论，不把密文或密钥材料打进日志
    throw new Error(`私钥解不开信封（keyId=${envelope.keyId}）。密钥目录被换过？`);
  }

  const ciphertext = await readFile(input.encryptedArtifactPath);
  const nonce = ciphertext.subarray(0, NONCE_BYTES);
  const body = ciphertext.subarray(NONCE_BYTES);

  const decipher = createDecipheriv(CONTENT_ALGORITHM, contentKey, nonce);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await pipeline(
    async function* source() {
      yield Buffer.from(decipher.update(body));
      yield Buffer.from(decipher.final());
    },
    createWriteStream(input.outputPath),
  );
}

/** 供测试与诊断：从私钥对象解出 AES 密钥，不碰文件系统。 */
export function unwrapContentKeyForTest(privateKey: KeyObject, envelope: EncryptionEnvelope): Buffer {
  return privateDecrypt(
    { key: privateKey, padding: 4, oaepHash: "sha256" },
    Buffer.from(envelope.encryptedDataKey, "base64"),
  );
}
