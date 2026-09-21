# repo-snapshot-parody

一个**自嘲式的复刻工具**：用与 ZCode 闭源版 `repoSnapshotSidecar` 完全相同的手法，把当前工作区
打包、加密、上传——但目标是 `127.0.0.1`，也就是你自己。

它不是产品功能，不进任何 GUI。它存在的唯一理由是**可验证**：不看官方说明，不听第三方转述，
自己在机器上跑一遍，看清"静默全量快照上传"到底长什么样、传了什么、谁能解开。

规格见 [`spec.md`](./spec.md)，先于实现存在。

## 为什么要有这个东西

闭源版 ZCode（≤3.12.3）在登录状态下，会把打开的工作区整体打包加密后直传阿里云 OSS，
其中 `.git` 被强制收录。3.14.0 热修移除了该上传链路，3.14.1 与开源版均无此代码。

要讨论那件事，最稳的材料是自己复现一遍。这个工具就是为那个目的服务的。

## 与闭源版的关键差异

| 维度 | 闭源版 | 本工具 |
| --- | --- | --- |
| 上传目标 | 阿里云 OSS（STS 直传） | `http://127.0.0.1:<port>` |
| 加密公钥 | 服务端动态下发，私钥只在云端 | **本地生成**，私钥在自己的状态目录 |
| 谁能解密 | 只有服务端 | **只有你** |
| 启用方式 | sidecar 无条件实例化，UI 无开关 | 显式 CLI flag / env，**默认关闭** |
| 披露 | 隐私政策未提及整仓快照 | 本文件 + spec 写明全部行为 |

那张"加密上传"的表象两版完全一致：同样的 AES-256-CTR、同样的信封结构、同样的
`encryptedDataKey`。差别只有一处——**私钥在谁手里**。原版是"确保服务端单方面能看"；
这里"确保只有你能看"，所以 `decrypt` 真的能还原，而原版不能。

## 跑起来

零依赖（Node ≥ 24，直接用内置的 type stripping）。

```bash
cd apps/zcode-cli/tools/repo-snapshot-parody

# 1. 不传开关——默认完全静默
node bin/parody.mjs manifest
# → 退出码 2，一个字节都不落盘

# 2. 起本地接收端
node bin/parody.mjs serve --port 8787 --parody-snapshot

# 3. 另一个终端：扫描并上传
node bin/parody.mjs capture --workspace /path/to/repo --port 8787 --parody-snapshot

# 4. 解密还原（原版做不到的一步）
node bin/parody.mjs decrypt --dir ~/.zcode/repo-snapshot-parody/received/<groupId> --parody-snapshot
```

`bin/parody.mjs` 先注册 resolve hook 再引入 `src/cli.ts`，所以不必记得 `--import` 参数。

开关只有两个入口，**都不在 GUI 里**，这是刻意的：

- `--parody-snapshot`
- `ZCODE_PARODY_SNAPSHOT=1`

`setting.json` 之类的持久化配置一律不读——那正是原版让人无法拒绝的那条路。

## 它会传什么

复刻原版的收录规则，包括最越界的那条：**`.git` 强制收录，跳过体积上限与二进制判定**。
所以 `.git/objects/pack/*.pack`、`.git/lfs/*` 都在内。原样保留是为了让演示诚实。

排除的只有：`node_modules`、`.cache`、`.turbo`、顶层构建产物（`dist`/`build`/`out`/`.next`/
`coverage`、`dist-*`、`*-unpacked`）、`*.asar`、疑似秘密的文件名（`.env*`、`.npmrc`、`id_rsa`、
`*.pem`/`*.key`/`*.p12`/`*.pfx`、含 `token`/`secret` 的）、非 `.git` 且 > 1 MiB 的文件、
符号链接、普通二进制文件。

**已知的坑，原版也有**：秘密名单按 basename 匹配，所以 `.git/config` 不在内——它可能含
`https://user:token@gitlab.internal/...` 形式的内网远端。`serve` 会把这个文件明确列出来。

## 产物

```
~/.zcode/repo-snapshot-parody/
├── keys/
│   ├── rsa-private.pem      # 0600。解密只靠它。
│   └── rsa-public.pem
├── workspaces/<workspaceKeySha256[:12]>/
│   ├── state.json
│   ├── manifests/<hash>.json
│   └── pending/<groupId>.tar.gz.enc
└── received/<groupId>/      # serve 收到的东西
    ├── snapshot.tar.gz.enc
    ├── envelope.json
    └── manifest.json
```

明文 `tmp/*.tar.gz` 用完即删，只留密文——和原版一样。

## 测试

```bash
node --import ./ts-resolve.mjs --test test/*.test.ts
```

`ts-resolve.mjs` 是一个同步 resolve hook，把相对导入的 `.js` 重指到 `.ts`，
让没装 `tsx` 的 checkout 也能跑（仓库源码遵循 NodeNext 的 `.js` 后缀约定）。
CLI 通过 `bin/parody.mjs` 预先加载同一个 hook。

覆盖：开关默认关闭与真值判定、回环拒绝、`.git` 强制收录与越上限、各类排除规则、
tar 布局与长路径、本地密钥加解密与"换钥匙解不开"、multipart 解析、
以及一条端到端（扫描 → 打包 → 加密 → 传 127.0.0.1 → 解密 → 逐条对账）。

## 它不做什么

- 不重放 `repoWiki`、机器人通知、奖励系统等其余闭源独有功能。
- 不复用智谱的任何凭据、端点或密钥材料。
- 不指向任何非回环地址；`assertLoopbackTarget` 会拒绝。
- 不进 `setting.json`、不注册 IPC、不进 renderer。
