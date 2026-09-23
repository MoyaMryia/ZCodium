# DeskPilot：跨平台桌面控制面（`desk.*`）

## 背景

开源仓里 Computer Use 的链路已经齐备，只差一个真实现：

| 层                                 | 状态                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `node-repl-host/src/cua-broker.ts` | 完整且通用：Unix socket / Windows 命名 pipe、32B token、1 MiB 上限、abort |
| `node-repl-host/src/cua-bridge.ts` | 完整且通用：JSON 行协议、id 配对、stale generation 防护、subagent 拒绝    |
| `zcode-cua-plugin/scripts/*`       | 模型可见面已移植                                                          |
| `packages/zcode-cua/index.js`      | **fail-closed 占位**                                                      |
| 原生执行层                         | **不存在**：闭源是 macOS-only 的 `ZCode Computer Use.app`，Linux 包不发   |

闭源实现有两个本 spec 不继承的边界：它只支持 macOS/Windows，Linux 包连 Helper 都不带；
它的 element index 绑定单次 observation，跨 observation 即失效。

本 spec 定义一套**全新的**桌面控制面，产品名 DeskPilot，模型可见面 `agent.deskPilot.desk.*`，
原生执行层是一个自研的 `surface-daemon`，覆盖 **Windows / macOS / Linux X11 / Linux Wayland**。

### 调研结论（2026-09，GitHub）

| 项目                      | 可借鉴                                                          | 不满足我们的点                     |
| ------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `trycua/cua` (26k)        | 三入口收敛到同一 core contract；显式公布平台边界                | 感知只有截图/a11y，无 OCR/DOM 阶梯 |
| `lahfir/agent-desktop`    | qualified ref、progressive skeleton 下钻（省 78–96% token）     | 仅 macOS                           |
| `AmrDab/clawdcursor`      | a11y+OCR 融合的 UI map、cheapest-tier-first、动作后 expect 复核 | macOS 走 JXA、Wayland 靠 ydotool   |
| `CursorTouch/Windows-MCP` | Windows UIA 用法                                                | 仅 Windows                         |
| `xlang-ai/OSWorld(-V2)`   | 验收基准                                                        | —                                  |

可用的 Rust 原语 crate（已核实版本）：`enigo 0.6.1`（输入，Wayland/libei 为实验 feature）、
`xcap 0.9.8`（截屏，**Wayland 不支持**）、`atspi 0.30.0`（纯 Rust AT-SPI，免 `python3-gi`）、
`uiautomation 0.25.1`、`objc2 0.6.4`、`ashpd 0.13.13`（XDG portal）、`x11rb 0.14.0`、
`reis 0.7.1`（libei 客户端）、`zbus 5.19.0`。

**P0 骨架实际引入的依赖**（其余等对应后端落地时再逐个收紧，避免提前锁死未经编译验证的组合）：
`serde` / `serde_json` / `thiserror` / `tracing` / `tracing-subscriber` / `tokio`，以及平台三项
`windows 0.58`（仅 windows target）、`objc2 0.6`（仅 macOS target）、
`zbus 5` + `ashpd 0.13` + `x11rb 0.14` + `reis 0.7`（仅 Linux target）。

已验证工具链 `cargo 1.98.1 / rustc 1.98.1`，三个 target 全部通过
`cargo check` / `cargo clippy -- -D warnings` / `cargo fmt --check`：
`x86_64-unknown-linux-gnu`（本机实测运行 daemon）、`x86_64-pc-windows-msvc`、`aarch64-apple-darwin`。
`ashpd` 必须显式开 `tokio` feature——它的 `default-features = false` 之后不会自动带运行时，
且 RemoteDesktop / ScreenCast / Clipboard 三个 portal API 各自是独立 feature。

**空白**：没有一套同时做到「四平台含 Wayland ＋ a11y-first 感知阶梯 ＋ 稳定 ref ＋ 动作自校验
＋ 能力诚实声明 ＋ 统一权限闸门」。Wayland 是所有人的短板，也是本 spec 的差异化重点。

## 范围

- 16 个 `desk.*` 工具，背后是同一份 `contract.ts`。
- 四类平台后端，由同一个 Rust trait 实现。
- 只操作**用户本机桌面**；不涉及远程桌面、云桌面、虚拟机。

## 非目标

- **不移植闭源 Helper**。`ZCode Computer Use.app` 是 106 MiB 签名可执行文件，闭源且仅 macOS。
- **不替换现有 `computer.*`**。两者并存，`computer.*` 继续 fail-closed；迁移是独立决策。
- **不做浏览器控制**。WebView/Chromium 应用通过 `attach_cdp` 交回 Browser Use。
- **不引入需要 root 的方案**（`/dev/uinput`、`ydotool` 提权），Wayland 输入只走 portal 与
  wlroots 虚拟输入协议。
- **不绕过平台安全模型**。Wayland 禁止合成输入是组合器的设计决策，不是实现缺陷。

## 设计决策

| #   | 决策                                                                                                             | 理由                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D1  | **能力声明优先**：daemon 启动时一次性上报 `CapabilitySet`，core 冻结后只读，模型看到的工具表按能力裁剪           | 四平台原语差异是客观事实。假装一致会让模型在 Wayland 上反复失败；冻结避免运行期漂移       |
| D2  | **四级感知阶梯 + 来源溯源**：`a11y → ocr → dom → vision`，每个元素带 `source/confidence/observed_at/fingerprint` | token 成本随任务难度增长；a11y 免费、OCR 廉价、截图昂贵。溯源让模型能判断该不该信某个元素 |
| D3  | **稳定 ref 而非坐标**：`@<snapshot>:e<n>`，坐标是最后手段且强制绑定 `frameId`                                    | 坐标跨 DPI/缩放/布局变化即失效；绑定 frame 后失效可被检测而非静默点错                     |
| D4  | **可验证执行**：破坏性动作可带 `expect`，动作后重新观测，返回 `verified / deviation / unverified`                | 「返回 ok 但 UI 没变」是桌面 agent 最主要的静默失败。三态里 `unverified` 是合法答案       |
| D5  | **Action Lease**：桌面是独占资源，动作必须持租约                                                                 | 多 agent/subagent 并发时没有互斥就会互相打断；租约让「谁在控制桌面」成为可查询事实        |

## 状态所有者

| 状态                        | 唯一所有者                                              | 其他层                                      |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `CapabilitySet`             | core 的 `capabilityRegistry`                            | 只读；daemon 只在启动时上报一次             |
| `UiMap` / snapshot 命名空间 | core 的 `observationCache`                              | daemon 无状态，每次调用取平台当前值         |
| Action Lease                | `packages/desktop/src/main/deskPilot/service.ts`        | core 只申请/续租/释放                       |
| 权限与授权                  | `packages/services/src/desk-pilot/permissionService.ts` | daemon 只回报事实（granted/denied/unknown） |
| 安全裁决                    | `packages/services/src/desk-pilot/policyGate.ts`        | 单一函数 `evaluate()`，agent 无法绕过       |

core 不缓存任何平台状态（窗口列表、坐标、剪贴板），每次向 adapter 取当前值——否则跨平台的
窗口 id 语义差异会造成陈旧判断。

## 分层架构

```text
模型 cell (node_repl js)
└─ desk-pilot-plugin/scripts/desk-client.mjs            ≤400 行  模型可见面
   │  Symbol.for("zcode.node-repl.desk-bridge")
└─ node-repl-host 的 desk-bridge / desk-broker          JSONL over unix socket / named pipe
   │  32B token + timingSafeEqual · 1 MiB 请求上限 · abort 传播 · stale generation 防护
└─ @zcode/desk-pilot/core                               纯逻辑：UiMap 缓存、ref 解析、verify、lease
   │  同一个 SurfaceAdapter 接口
└─ @zcode/desk-pilot/adapters/<platform>
   └─ surface-daemon（每平台一个原生二进制）              唯一碰 FFI 的地方
      ├─ win32      : UIA(COM) + Win.Graphics.Capture/D3D11 + SendInput
      ├─ darwin     : AXUIElement* + ScreenCaptureKit + CGEvent/CGEventPostToPid
      ├─ linux-x11  : AT-SPI(zbus) + XTest + XGetImage
      └─ linux-wayland : AT-SPI + libei(portal)/wlr-virtual-input + PipeWire ScreenCast
```

## 平台能力矩阵

这张表就是产品文档，不许粉饰。`capabilities` 工具返回它的运行时实例。

| 原语           | Windows 10/11        | macOS 12+                           | Linux X11                   | Linux Wayland                                       |
| -------------- | -------------------- | ----------------------------------- | --------------------------- | --------------------------------------------------- |
| 枚举应用/窗口  | UIA + AUMID          | AX + CGWindowList                   | AT-SPI + `_NET_CLIENT_LIST` | AT-SPI + portal AppPicker；wlroots 可补 `toplevel`  |
| 读 UI 树       | UIA ControlType→kind | AXUIElement 全量属性                | AT-SPI（纯 Rust）           | 同 X11                                              |
| 后台语义动作   | UIA Invoke/Value     | AX action + `AXManualAccessibility` | AT-SPI Action               | 同 X11                                              |
| 定向后台输入   | SendInput（限前台）  | `CGEventPostToPid`                  | XTest（限前台）             | **libei（portal 授权）** / wlr-virtual-input        |
| 指针/滚轮      | SendInput + DPI 感知 | CGEvent                             | XTest                       | libei / wlr-virtual-pointer                         |
| 键盘（含 IME） | SendInput            | CGEventKeyboardSetUnicodeString     | XTest + XIM                 | libei / wlr-virtual-keyboard；IBus 旁路需显式开关   |
| 全屏截图       | Win.Graphics.Capture | ScreenCaptureKit                    | `XGetImage`                 | **PipeWire via portal ScreenCast（需授权）**        |
| 窗口截图       | WGC verified capture | SCContentFilter                     | `XGetImage` 裁剪            | 仅 ScreenCast window source（需授权）               |
| 剪贴板         | Win32 clipboard      | NSPasteboard                        | X11 selection               | portal 无读权限 → `wl-paste` 或**声明只写**         |
| 应用身份       | exe 路径 + AUMID     | bundle id + Team ID                 | `.desktop` id               | 同 X11                                              |
| 所需授权       | 无                   | Accessibility + Screen Recording    | 无                          | **ScreenCast + RemoteDesktop 两次用户授权**         |
| **能力结论**   | 完整                 | 完整                                | 完整（X11 语义）            | **感知完整；输入/截图需 portal 授权，未授权时只读** |

### Wayland 专项

输入按以下顺序选择，第一个可用即止，选择结果写进 `CapabilitySet.notes`：

1. `reis`（libei 客户端）+ `ashpd` RemoteDesktop portal —— 唯一合规且通用的路径，代价是每次会话
   要用户授权。
2. wlroots `zwlr_virtual_pointer_manager_v1` / `zwp_virtual_keyboard_manager_v1` ——
   Sway/Hyprland/river/wayfire 可用，无弹窗，但 compositor 专属。
3. 不可用 → `capabilities().pointer === false`，调用返回 `UNSUPPORTED_ON_PLATFORM` 且
   `possiblySent: false`。

截图：portal ScreenCast → PipeWire 流；wlroots 上可用 `grim` 作为无需授权的降级（仅全屏）。
窗口级截图在 Wayland 上只有 ScreenCast 的 window source 一条路。

剪贴板：Wayland 的 portal 不提供读权限。实现为「写总是可用；读需要 `wl-paste` 或声明
`clipboardRead: false`」，不允许静默返回空字符串冒充成功。

## 工具面（16 个）

| 组   | 工具                                       | 说明                                                         |
| ---- | ------------------------------------------ | ------------------------------------------------------------ |
| 能力 | `capabilities`                             | 返回冻结的 `CapabilitySet`（平台 × 原语 × 授权态）           |
| 观测 | `surfaces`                                 | 枚举可操作界面：app / window / webview / canvas              |
| 观测 | `observe`                                  | 产出 `UiMap`；`depth` 支持骨架下钻                           |
| 观测 | `inspect`                                  | 按 ref 读单元素属性（value/checked/enabled/actions/bounds）  |
| 指针 | `act_on`                                   | 语义优先：执行元素自报的 `actions` 之一                      |
| 指针 | `point`                                    | 坐标点击（最后手段），必须绑定 frame，且先 hit-test 证明归属 |
| 指针 | `drag` / `scroll`                          | 拖拽 / 滚动；scroll 无 a11y 原语，明确告知走 raw             |
| 键盘 | `type_text` / `set_field` / `select_range` | 输入 / 直设 value（可设置才允许）/ 选文本                    |
| 键盘 | `key`                                      | 和弦，跨平台修饰键归一（cmd ⇄ ctrl）                         |
| 剪贴 | `paste`                                    | 读-改-写-粘贴，带 pasteboard 标记证明是自己发的              |
| 网页 | `attach_cdp`                               | Chromium 系应用开 DevTools 口走 DOM，原生菜单仍走 a11y       |
| 会话 | `request_access`                           | **只报告**授权状态与缺失项，不自动提权                       |
| 会话 | `stop`                                     | kill switch，永不受 lease / kill switch 约束                 |

破坏性动作统一携带：

```ts
{ target, expect?: Expectation, idempotencyKey?: string }
```

返回 `{ possiblySent, verification }`，其中 `verification ∈ verified | deviation | unverified`。

## 协议与核心数据结构

线协议一请求一响应，与现有 broker 同形：

```jsonc
// request
{ "id":"uuid", "token":"32B hex", "method":"observe", "input":{...},
  "context":{ "session_id","workspace_key","agent_id","lease_id","runtime_scope" } }
// response
{ "id":"uuid", "ok":true,  "result":{...} }
{ "id":"uuid", "ok":false, "error":"msg", "code":"STALE_REF", "possibly_sent":false,
  "recovery":"Call observe again; refs are bound to snapshot_id." }
```

`UiMap`（契约核心，见 `packages/desk-pilot/src/ui-map.ts`）：

```jsonc
{ "snapshot_id":"s_ab12", "surface":{"pid":123,"window_id":456},
  "frame":{"frame_id":"f_1","width_px":2560,"height_px":1440,"scale_factor":2},
  "source_mix":{"a11y":142,"ocr":3},
  "truncated":true, "truncated_at_depth":3,
  "elements":[ { "ref":"@s_ab12:e7", "kind":"button", "name":"Send",
                 "bounds":[x,y,w,h],                  // 诊断用，禁止当坐标目标
                 "flags":["pressable"], "actions":["press"],
                 "provenance":{"source":"a11y","confidence":1,"fingerprint":"button@Send@/win[0]/pane[3]"} } ] }
```

错误码（跨平台同语义）：

| 码                        | 含义                         | possibly_sent |
| ------------------------- | ---------------------------- | ------------- |
| `STALE_REF`               | ref 不属于最新 snapshot      | false         |
| `SURFACE_REPLACED`        | window_id 已不代表原界面     | false         |
| `IDENTITY_CONFLICT`       | app_ref 各字段指向不同活界面 | false         |
| `OWNERSHIP_UNPROVEN`      | hit-test 无法证明目标归属    | false         |
| `UNSUPPORTED_ON_PLATFORM` | 平台不支持该原语             | false         |
| `PERMISSION_DENIED`       | 授权缺失                     | false         |
| `TOOL_TIMEOUT`            | daemon 超时                  | 视是否已下达  |
| `DEVIATION`               | expect 未满足                | true          |
| `LEASE_NOT_HELD`          | 未持租约                     | false         |
| `SUBAGENT_UNAVAILABLE`    | subagent 无桌面控制权        | false         |

## 安全模型

1. **单一闸门 `policyGate.evaluate()`**：所有调用（编辑器 stdio / HTTP 外部 agent / 内置 loop）
   都必须过这一个函数。
   - `allow`：读、打开应用、导航、非敏感字段输入
   - `confirm`：发送、删除、购买、关闭窗口/退出应用、敏感应用（邮件/银行/密码管理器/私聊）
   - `block`：`Ctrl+Alt+Del`、锁屏、注销、关机序列 —— 直接拒，无路径
2. **Action Lease**：`acquireLease(agentId, ttl)` 成功才能动；subagent 默认无租约 →
   `SUBAGENT_UNAVAILABLE`；租约过期自动失效，不用超时掩盖同步问题。
3. **Kill switch**：`stop` 工具 + 桌面常驻「正在被控制」横幅（红点闪烁，双击即停）。
4. **身份校验**：`app_ref` 的 pid / bundle_id(exe) / name / window_id 必须指向同一个活界面；
   坐标动作前必须 hit-test 回证 owner pid。
5. **隐私**：密码字段值一律脱敏（`AXSecureTextField` / UIA `IsPassword` / AT-SPI password state）
   后再进模型上下文；屏幕文本统一包在 `<untrusted-screen-content>` 里当**数据**不当**指令**；
   截图只进 RAM，默认无遥测。
6. **possibly_sent**：已通过 daemon 下达到平台的 → `true`；参数校验阶段失败 → `false`。
   不动的时候绝不报成功。

## 模块划分与架构合规

```text
packages/desk-pilot/                        # 新 workspace 包，纯 TS
  src/
    module.ts               模块清单（architecture-policy.yaml 同源）
    contract.ts             唯一公开入口：SurfaceAdapter 端口 + 核心标量（≤300 行，≤12 方法）
    ui-map.ts               UiMap / UiElement / 来源溯源
    actuation.ts             ActionTarget / PointerGesture / TextOp / KeyChord / Expectation
    errors.ts                DeskErrorCode / DeskPilotError / CapabilitySet
    guards.ts                纯校验：ref 解析、target 合法性（无 IO）
    contract.example.ts     模块必备样例
  test/
    contract.test.ts        node:test，18 个用例
    fixtures/fakeAdapter.ts 内存假 adapter
  CONTRACT.md
  native/                   Rust cargo workspace（架构检查器只扫 TS/JS，不介入）
    crates/surface-contract      serde 数据类型，与 TS contract 一一对应
    crates/surface-backend       SurfaceBackend trait（12 方法）+ BackendError + 后端选择
      src/backends/win32.rs      UIA + Win.Graphics.Capture + SendInput
      src/backends/darwin.rs     AX + ScreenCaptureKit + CGEvent/CGEventPostToPid
      src/backends/linux_x11.rs  AT-SPI(zbus) + XTest + XGetImage
      src/backends/linux_wayland.rs  AT-SPI + libei/wlr-virtual-input + PipeWire
    crates/surface-daemon        bin：JSONL server + dispatch + lifecycle
    build.mjs                   跨平台构建 + sha256 manifest

packages/services/src/desk-pilot/            contract.ts / permissionService.ts / policyGate.ts / auditLog.ts
packages/desktop/src/main/deskPilot/         service.ts / daemonHost.ts / banner.ts / permissionIpc.ts
apps/zcode-cli/packages/desk-pilot-plugin/   scripts/desk-client.mjs 等五模块 + skills/desk-pilot/SKILL.md
```

四个后端放在同一个 crate 里用 `#[cfg(target_os)]` 门控，而不是四个 crate：
Linux 的 X11/Wayland 在同一个目标上编译（跑哪个是运行时按 `XDG_SESSION_TYPE` 决定的），
Windows/macOS 后端分别依赖 `windows` / `objc2`，拆成独立 crate 会让 workspace 在
Linux 上也要编译 macOS 依赖。

`architecture-policy.yaml` 注册：

```yaml
- id: desk-pilot
  roots: [packages/desk-pilot/src]
  managed: true
  requires: []
  publicEntrypoints: [packages/desk-pilot/src/contract.ts]
  owner: desktop
```

合规要点：`maxFileLines 400` → 每个文件留余量；`forbidDeepImports` → 只从 `contract.ts` 出；
`maxPublicMethods 12` → `SurfaceAdapter` 恰好 12 个方法，按输入通道收敛而非一个动词一个方法；
`forbidCycles` → `core → adapters → native` 单向。

### 线格式规则（Rust ↔ TS）

两侧字段名不一致时**编译期完全没有信号**，只在 host 反序列化 daemon 响应时才炸，而且表现是
`PROTOCOL_VIOLATION` 这种离根因很远的错误。规则只有四条：

| 位置                | 规则                           | 例证                                 |
| ------------------- | ------------------------------ | ------------------------------------ |
| 结构体字段          | camelCase，与 TS 一致          | `snapshotId` / `possiblySent`        |
| 枚举 tag 值         | snake_case                     | `element_gone` / `portal_screencast` |
| `PlatformId`        | **kebab-case**（全仓唯一例外） | `linux-x11` / `linux-wayland`        |
| Rust 的 `ref_` 字段 | `#[serde(rename = "ref")]`     | TS 侧字段名就是 `ref`                |

守卫在 `native/crates/surface-contract/tests/wire_format.rs`：正向断言每个结构体序列化出的
key 名，反向按 TS 字面量形状手写 JSON 做反序列化。新增字段忘了同步 TS 会让这里直接红。

### 传输层

Unix domain socket（macOS/Linux）与 Windows named pipe 共用同一份行协议，只有"拿到一个已连接的流"
不同：`serve_connection` / `write_response` 泛型化为 `AsyncRead + AsyncWrite + Unpin`，
`serve()` 按 `cfg` 分叉。pipe 名允许 host 直接传 `\\.\pipe\desk-pilot-<hash>`，
也允许传普通路径（用文件名派生），这样同一套 `DESK_PILOT_SOCKET` 三平台不用改。
Windows 路径只做过编译验证，真机运行未验证。

## 实施顺序

| 阶段 | 内容                                                              | 状态                                       |
| ---- | ----------------------------------------------------------------- | ------------------------------------------ |
| P0   | `contract.ts` + 纯 guards + 假 adapter 单测 + surface-daemon 骨架 | 本仓已落地，Rust 侧三 target 编译/测试通过 |
| P1   | core：UiMap 缓存 / ref / verify / lease                           | 未开始                                     |
| P2   | daemon win32 + darwin 后端                                        | 未开始                                     |
| P3   | daemon linux-x11 后端                                             | 未开始                                     |
| P4   | **daemon linux-wayland 后端**                                     | 未开始                                     |
| P5   | 模型面 + 安全闸门 + 横幅 + 租约                                   | 未开始                                     |
| P6   | OSWorld-V2 基准 + 自建 Wayland 场景                               | 未开始                                     |

## 验收场景

1. **能力诚实**：未授权的 Wayland 会话里 `capabilities` 报告 `pointer=false`、`capture=false`，
   `point` 返回 `UNSUPPORTED_ON_PLATFORM` 且 `possibly_sent=false`。不允许静默失败或伪造成功。
2. **动作自校验**：对发送按钮传 `expect`，UI 未变化时必须得到 `verification:"deviation"`，
   而不是 `ok:true`。
3. **token 效率**：Slack/VS Code 级密度应用上 `observe({depth:3})` 的 token 数 ≤ 全量的 25%。
4. **契约不变量**（P0 已覆盖）：ref 格式非法、跨 snapshot 寻址、无 frame 的坐标目标、
   密码字段 flags 缺失，都必须在进入 adapter 之前被拒绝。
5. **`pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed`** 全绿。

## 迁移边界

- 不改 `packages/zcode-cua`、`node-repl-host/src/cua-*.ts`、`zcode-cua-plugin`。
- 不删 `computer.*` 的任何现有行为。
- `desk.*` 与 `computer.*` 共用 broker 的 socket 命名空间但使用不同前缀，互不抢占。
