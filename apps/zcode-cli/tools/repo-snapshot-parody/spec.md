# repo-snapshot-parody — 规格

> 本文件先于实现存在。修改任何行为前先改这里。

## 这是什么

一个**自嘲式的复刻工具**：用与 ZCode 闭源版 `repoSnapshotSidecar` 完全相同的手法，把当前工作区
打包、加密、上传——但目标是 `127.0.0.1`，也就是你自己。

它存在的唯一理由是**可验证地展示那套机制**：不看官方说明，不听第三方转述，自己在机器上跑一遍，
看清"静默全量快照上传"到底长什么样、传了什么、谁能解开。

## 非目标

- 不是产品功能。不进入任何 GUI、不进 `setting.json`、不进遥测。
- 不追求性能。`scan` 是同步全量遍历，故意不做增量索引优化。
- 不复用智谱的任何凭据、端点或密钥材料。

## 与 ZCode 原版的关键差异（讽刺的落点）

| 维度 | ZCode 原版 | 本工具 |
| --- | --- | --- |
| 上传目标 | 阿里云 OSS（STS 直传） | `http://127.0.0.1:<port>`，默认仅回环 |
| 加密公钥 | **服务端动态下发**，私钥只在云端 | **本地生成**，私钥落在你自己的状态目录 |
| 谁能解密 | 只有智谱后端 | **只有你** |
| 启用方式 | sidecar 无条件实例化，UI 无开关 | 显式 CLI flag / env，**默认关闭** |
| 披露 | 隐私政策未提及整仓快照 | 本 spec + README 写明全部行为 |

那张"加密上传"的表象两版完全一致：同样的 AES-256-CTR、同样的信封结构、同样的 `encryptedDataKey`。
差别只有一处——**私钥在谁手里**。原版是"确保服务端单方面能看"；这里"确保只有你能看"。

## 开关：刻意不做进 GUI

理由：原版的问题不只是"传了什么"，更是"用户没有任何拒绝的入口"。所以本工具的开关必须
满足以下全部条件，缺一不可：

1. **默认关闭。** 不传 flag、不设 env 时，`capture` 直接退出并打印原因。
2. **只能来自命令行或环境变量。** 明确禁止从 `setting.json` / `config.json` / 任何持久化
   配置文件读取——那些都是应用自己写得了的路径，等于把开关交回给应用。
3. **不进任何设置界面。** 不新增 `settings.*` 词条、不注册 IPC、不进 renderer。

启用条件（任一）：

- CLI flag：`--parody-snapshot`
- 环境变量：`ZCODE_PARODY_SNAPSHOT=1`

`ZCODE_` 前缀遵循 `apps/zcode-cli/AGENTS.md` 的自有环境变量约定。取值判定只认
`1` / `true` / `yes` / `on`（大小写不敏感），其余一律视为未启用——**不猜**。

### 本工具引入的环境变量

| 变量 | 用途 | 缺省 |
| --- | --- | --- |
| `ZCODE_PARODY_SNAPSHOT` | 总开关 | 未设置 = 关闭 |
| `ZCODE_PARODY_STATE_DIR` | 状态/密钥/产物根目录 | `~/.zcode/repo-snapshot-parody` |

不用 `setting.json`：见上文第 2 条。端口只用 `--port`，不做成持久化配置。

## 扫描范围

复刻原版的取舍，不做"改进"：

**收录**

- `git ls-files --cached --others --exclude-standard -z` 的全部条目（已跟踪 + 未跟踪未忽略）
- `.git` 目录整体**强制收录**，且：
  - 跳过体积上限（原版 `.git` 分支排在 `large-file` 判定之前）
  - 跳过二进制判定（原版 `shouldIncludeRepoSnapshotPath` 对 `.git` 直接 `include:true`）

  这意味着 `.git/objects/pack/*.pack`、`.git/lfs/*` 都在内。**这是原版最越界的地方，
  原样保留是为了让演示诚实。**

**排除**（与原版同规则）

- `node_modules`、`.cache`、`.turbo`
- 顶层构建产物：`dist` / `build` / `out` / `.next` / `coverage`，以及 `dist-*`、`*-unpacked`
- `*.asar`、`app.asar.unpacked`
- 疑似秘密的文件名：`.env` / `.env.local` / `.env.development` / `.env.production` /
  `.npmrc` / `id_rsa` / `id_dsa` / `id_ecdsa` / `id_ed25519` / `*.pem` / `*.key` /
  `*.p12` / `*.pfx`，以及文件名含 `token` / `secret` 的
- 非 `.git` 且 > 1 MiB 的文件
- 符号链接（原版 `unsupported`）
- 采样含 NUL 字节的二进制文件（`.git` 除外）

**注意**：秘密名单按 basename 匹配，因此 `.git/config` 不在内——它可能含
`https://user:token@host/...` 形式的远端。原版如此，此处原样保留并在 README 说明。

## 产物

```
<stateDir>/repo-snapshot-parody/
├── keys/
│   ├── rsa-private.pem      # 本地生成的私钥，0600。解密只靠它。
│   └── rsa-public.pem       # 对应公钥，写入信封
└── workspaces/<workspaceKeySha256[:12]>/
    ├── state.json
    ├── manifests/<manifestHash>.json
    ├── pending/<groupId>.tar.gz.enc
    ├── pending/<groupId>.envelope.json
    └── tmp/<groupId>.tar.gz          # 明文，用完即删
```

`workspaceKey` 取 `workspacePath` 的规范化绝对值；目录名用其 SHA-256 前 12 位，
不在路径上泄漏工作区位置。

## 状态机

`state.json` 字段（对齐原版，便于对照）：

- `workspacePath` / `workspaceKey`
- `lastAcceptedManifestHash` / `lastAcceptedManifestPath`：上一次被服务端确认收录的清单，
  用于算增量
- `activeUpload` / `latestPendingUpload`：当前与最近一次待上传记录
- `lastCompressedSize`：`{ encryptedSizeBytes, workspaceSizeBytes, manifestHash, recordedAt }`
- `failureCount`：连续失败次数

首次为 `baseline`（全量），之后按 `lastAcceptedManifestHash` 与当前清单算 delta，
只打包新增/修改文件（`increment`）。删除项记入 `delta.deleted`，不回传内容。

## 上传

`POST http://127.0.0.1:<port>/snapshot`，`multipart/form-data`。字段名刻意模仿原版的
OSS 表单，便于并排对比：

| 字段 | 原版 | 本工具 |
| --- | --- | --- |
| `key` | OSS object path | `parody/<workspaceHash>/<groupId>.tar.gz.enc` |
| `policy` / `x-oss-signature` / `x-oss-credential` / `x-oss-security-token` | OSS STS 签名 | 不适用，留空或省略 |
| `callback` | base64 的 `{callbackUrl, callbackBody}` | 同形状，指向本地 |
| `success_action_status` | `200` | `200` |

本地接收端 `serve` 把 artifact / envelope / manifest 落盘，并打印**它到底收到了什么**：
文件数、字节数、前若干条路径。这是整个工具的核心输出——让你直视"服务端当时看到了什么"。

## 解密

`decrypt` 用 `keys/rsa-private.pem` 解信封里的 `encryptedDataKey`，再解 AES-256-CTR，
产出明文 tar.gz。**这一步原版做不到**，因为私钥不在客户端。

## 错误行为

| 情况 | 行为 |
| --- | --- |
| 开关未启用 | 退出码 2，stderr 打印"未启用"及启用方式，**不写任何文件** |
| 目标非回环 | 退出码 2，拒绝。默认只允许 `127.0.0.1` / `::1` / `localhost` |
| 接收端不可达 | 记 `failureCount += 1`，artifact 留在 `pending/` 等重试；不静默丢弃 |
| `git` 不可用或非仓库 | 退化为纯文件系统遍历，manifest 标注 `source: "walk"` |
| 扫描中文件消失 | 跳过该条目，不计失败 |
| 解密失败 | 退出码 1，打印信封摘要（不含密文），不重试 |

## 验收场景

1. 未传开关 → 退出码 2，无任何产物目录生成。
2. 启用后 `capture` → 生成 `baseline` 产物；manifest 的 `stats.includedFileCount` 与实际遍历一致。
3. 同一工作区二次 `capture` 且服务端已确认 → `kind: "increment"`，只含 delta 文件。
4. `serve` 收到后打印的文件清单与 manifest 一致。
5. `decrypt` 能用本地私钥解出明文，且明文 tar 内容与 manifest 逐条对应。
6. `.git/` 下的文件出现在 manifest 中，且不受 1 MiB 上限约束。
7. `node_modules/`、`dist/` 不出现在 manifest 中。
8. 目标设为非回环地址 → 退出码 2。
