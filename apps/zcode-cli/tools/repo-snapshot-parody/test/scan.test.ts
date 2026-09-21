import assert from "node:assert/strict";
import test from "node:test";
import {
  decideBeforeSample,
  decideAfterSample,
  workspaceKeyHash,
  workspaceKeyOf,
} from "../src/scan.js";

test(".git 被强制收录，且跳过体积上限", () => {
  const decision = decideBeforeSample({
    relativePath: ".git",
    sizeBytes: 500 * 1024 * 1024,
    isSymbolicLink: false,
  });
  assert.deepEqual(decision, { include: true, reason: "git-internal" });

  const pack = decideBeforeSample({
    relativePath: ".git/objects/pack/pack-abc.pack",
    sizeBytes: 200 * 1024 * 1024,
    isSymbolicLink: false,
  });
  assert.equal(pack.include, true);
});

test(".git 跳过二进制判定", () => {
  const decision = decideAfterSample({
    relativePath: ".git/objects/pack/pack-abc.pack",
    sample: Buffer.from([0x1f, 0x8b, 0x00, 0x00]),
  });
  assert.equal(decision.include, true);
});

test("普通二进制文件被排除", () => {
  const decision = decideAfterSample({
    relativePath: "assets/logo.bin",
    sample: Buffer.from([0x00, 0x01, 0x02]),
  });
  assert.deepEqual(decision, { include: false, reason: "binary" });
});

test("排除 node_modules / 缓存 / 构建产物 / asar", () => {
  const cases: Array<[string, string]> = [
    ["node_modules/left-pad/index.js", "dependency"],
    ["packages/ui/.cache/x.json", "cache"],
    ["packages/ui/.turbo/x.json", "cache"],
    ["dist/bundle.js", "build-output"],
    ["out/main/index.js", "build-output"],
    ["dist-server/bundle.js", "build-output"],
    ["foo-unpacked/x.js", "build-output"],
    // node_modules 判定排在 build-output 之前，与闭源版同序
    ["resources/app.asar.unpacked/node_modules/x/index.js", "dependency"],
    ["resources/app.asar", "build-output"],
  ];
  for (const [path, reason] of cases) {
    assert.deepEqual(
      decideBeforeSample({ relativePath: path, sizeBytes: 10, isSymbolicLink: false }),
      { include: false, reason },
      `应当排除 ${path}`,
    );
  }
});

test("排除疑似秘密文件名", () => {
  const cases = [
    ".env",
    ".env.production",
    ".npmrc",
    "id_rsa",
    "certs/server.pem",
    "certs/server.key",
    "certs/bundle.p12",
    "config/api-token.json",
    "config/my-secret.txt",
  ];
  for (const path of cases) {
    assert.deepEqual(
      decideBeforeSample({ relativePath: path, sizeBytes: 10, isSymbolicLink: false }),
      { include: false, reason: "secret" },
      `应当排除 ${path}`,
    );
  }
});

test("非 .git 的超大文件被排除", () => {
  assert.deepEqual(
    decideBeforeSample({ relativePath: "big.bin", sizeBytes: 1024 * 1024 + 1, isSymbolicLink: false }),
    { include: false, reason: "large-file" },
  );
  assert.equal(
    decideBeforeSample({ relativePath: "small.txt", sizeBytes: 1024 * 1024, isSymbolicLink: false })
      .include,
    true,
  );
});

test("符号链接一律不支持", () => {
  assert.deepEqual(
    decideBeforeSample({ relativePath: ".git/config", sizeBytes: 10, isSymbolicLink: true }),
    { include: false, reason: "unsupported" },
  );
});

test(".git/config 不在秘密名单内——复刻原版的这个漏洞", () => {
  // 原版的秘密判定按 basename 匹配，.git/config 的 basename 是 "config"，
  // 所以带 token 的自建 GitLab 远端会随 .git 一起出去。此处原样保留。
  const decision = decideBeforeSample({
    relativePath: ".git/config",
    sizeBytes: 200,
    isSymbolicLink: false,
  });
  assert.equal(decision.include, true);
});

test("workspace key 用规范化绝对路径，目录名用哈希", () => {
  const key = workspaceKeyOf("/tmp/../tmp/demo");
  assert.equal(key, "/tmp/demo");
  const hash = workspaceKeyHash(key);
  assert.match(hash, /^[0-9a-f]{12}$/u);
  assert.equal(hash, workspaceKeyHash(key), "同路径必须得到同目录名");
});
