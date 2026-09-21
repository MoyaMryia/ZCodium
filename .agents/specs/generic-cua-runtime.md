# 通用 Computer Use 运行时（Generic CUA Runtime）

## 背景

开源仓库的 Computer Use 链路已经齐备，只差一个真实现：

| 层                                                            | 状态                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `node-repl-host/src/cua-broker.ts`（181 行）                  | **完整且通用**：Unix socket / Windows 命名 pipe、随机 32 字节 token、`timingSafeEqual`、1 MiB 请求上限、abort 传播 |
| `node-repl-host/src/cua-bridge.ts`（204 行）                  | **完整且通用**：JSON 行协议、32 MiB 响应上限、id 配对、stale generation 防护、subagent 拒绝、app 身份捕获          |
| `zcode-cua-plugin/scripts/computer-use-client.mjs`（1208 行） | 已移植，模型可见面，仅依赖 node: 内建模块                                                                          |
| 工具注册表                                                    | 可从闭源 `node-repl-host/dist/mcp/server.js` 偏移 4,800,303 起提取                                                 |
| `packages/zcode-cua/index.js`                                 | **fail-closed 占位**（335 字节）                                                                                   |

线协议（`cua-broker.ts` ↔ `cua-bridge.ts`，已固定，不得更改）：

```
请求  {"id":"<uuid>","token":"<32B hex>","method":"<name>","input":{…},"context":{…}}\n
响应  {"id":"<uuid>","ok":true,"result":<CallToolResult>}\n
      {"id":"<uuid>","ok":false,"error":"<message>"}\n
```

broker 把 `runtime` 当普通参数注入，对实现方式完全无感。因此通用化只需替换
`createComputerUseRuntime()` 一个函数。

## 目标

用平台无关的方式实现 14 个 CUA 方法，使 Computer Use 在 **Linux / macOS / Windows**
上都可用，且不依赖智谱的 Helper 二进制或任何智谱服务端。

## 非目标（明确边界）

- **不移植智谱 Helper**。`ZCode Computer Use.app` 是 106 MiB 的签名可执行文件，
  内含 `ax_native.node`（macOS Accessibility API）。它是闭源产物，且仅 macOS 可用。
- **不追求与闭源逐字一致**。闭源在 macOS 上支持「定向窗口的后台输入」（不抢焦点），
  这依赖 Accessibility API；通用实现只在平台原生支持时提供，否则明确降级。
- **不绕过平台安全模型**。Wayland 禁止合成输入是设计决策，不是实现缺陷；
  本 spec 选择在能力矩阵中如实标注，不引入需要 root 的方案。
- **不做浏览器控制**。那已由 Browser Use（Playwright/CDP）覆盖。

## 架构

```
createComputerUseRuntime(options)          ← 本次实现的唯一入口
  └─ ComputerUseRuntime                     已有接口，勿改
       execute({toolName, arguments, context, signal}) → CallToolResult

  └─ Actuator                               ← 新接口，平台相关能力的唯一收敛点
       ├─ capabilities(): CapabilitySet
       ├─ screenshot(area?): Promise<PngBuffer>
       ├─ screenshotWindow(windowId): Promise<PngBuffer>
       ├─ listWindows(): Promise<WindowInfo[]>
       ├─ pointerMove / pointerDown / pointerUp / scroll
       ├─ keyTap(key, modifiers?)
       ├─ typeText(text)
       └─ clipboardRead / clipboardWrite
```

**状态所有者**：`Actuator` 实现是平台状态的唯一所有者。runtime 层不缓存任何平台
状态（窗口列表、坐标、剪贴板），每次调用都向 actuator 取当前值——否则跨平台的
窗口 id 语义差异会造成陈旧判断。

**为什么用 Actuator 而不是四份实现**：14 个方法的参数校验、`possibly_sent` 语义、
app 身份关联、错误归一化都是平台无关的，只实现一次；平台差异只存在于
「怎么点、怎么读屏、怎么枚举窗口」这三类原语。

## 平台能力矩阵

| 原语          | Linux X11                      | Linux Wayland                  | macOS                        | Windows                              |
| ------------- | ------------------------------ | ------------------------------ | ---------------------------- | ------------------------------------ |
| 全屏截图      | `import -window root`          | `grim`                         | `screencapture -x -t png`    | PowerShell `Graphics.CopyFromScreen` |
| 窗口截图      | `import -window <id>`          | `grim -g <geometry>`           | `screencapture -x -o -l<id>` | 同上（按窗口矩形裁剪）               |
| 枚举窗口      | `wmctrl -l` / `xdotool search` | 无标准工具，需 compositor 协议 | Accessibility API            | PowerShell `EnumWindows`             |
| 指针移动/点击 | `xdotool mousemove/click`      | **不可用**（见下）             | Accessibility API            | `mouse_event` / SendInput            |
| 键盘          | `xdotool key/type`             | **不可用**                     | Accessibility API            | SendInput                            |
| 剪贴板        | `xclip` / `xsel`               | `wl-copy` / `wl-paste`         | `pbcopy` / `pbpaste`         | PowerShell                           |

### Wayland 输入注入：如实标注为不可用

GNOME/KDE Wayland 下合成输入被组合器刻意禁止，三条路径都不适合本场景：

1. `xdotool` — 仅 X11，只影响 XWayland 客户端，原生 Wayland 应用无效
2. `ydotool` — 需要 root 与 uinput 权限，属于提升权限方案，不采用
3. XDG Portal RemoteDesktop — 唯一合规路径，但每次需用户授权弹窗，
   与「agent 自主完成任务」的目标冲突

**结论**：Wayland 下 `capabilities().pointer = false` / `keyboard = false`，
模型调用时返回明确的 `unsupported_on_platform` 错误，而不是静默失败或伪造成功。
XWayland 客户端可通过显式选择 X11 actuator 支持（用户已知其范围）。

## 输入实现方式

采用 **shell 调系统工具**，与闭源实现一致（闭源 `MACOS_SYSTEM_COMMANDS` 即
`screencapture` / `osascript` / `pbcopy` 等，经 `execFile` 参数数组调用）。

理由：

- 符合仓库规范（`child_process.spawn` / `execFile` 参数数组，避免 shell 拼接）
- 无原生编译依赖，跨平台迁移成本低
- 工具缺失时可检测并给出可操作的错误提示

约束：

- 所有外部命令必须走统一的 command runner，集中处理超时、退出码归一化、
  输出大小上限、stderr 捕获
- 命令不存在时返回 `tool_unavailable` 并附带安装建议，不静默降级
- 不通过 shell 执行，参数一律数组传递

## 14 个方法的语义

分组来自闭源 `TOOL_NAMES`（偏移 4,800,303），注解表与 app 关联模式同源：

| 方法                    | 组          | 副作用 | app 关联  |
| ----------------------- | ----------- | ------ | --------- |
| `list_apps`             | observation | 无     | `items`   |
| `list_windows`          | observation | 无     | `primary` |
| `get_app_state`         | observation | 无     | `primary` |
| `left_click`            | pointer     | 破坏性 | `primary` |
| `scroll`                | pointer     | 破坏性 | `primary` |
| `left_click_drag`       | pointer     | 破坏性 | `primary` |
| `type`                  | keyboard    | 破坏性 | `primary` |
| `set_value`             | keyboard    | 破坏性 | `primary` |
| `select_text`           | keyboard    | 破坏性 | `primary` |
| `key`                   | keyboard    | 破坏性 | `primary` |
| `perform_action`        | semantic    | 破坏性 | `primary` |
| `paste`                 | paste       | 破坏性 | `primary` |
| `request_access`        | runtime     | 无     | `none`    |
| `stop_computer_control` | runtime     | 无     | `none`    |

`KILL_SWITCH_EXEMPT = {request_access, stop_computer_control}`——这两项不受 kill
switch 约束，必须始终可用。

### possibly_sent 语义

动作失败时若**可能已下发**，错误必须携带 `actionSent: true`。判定规则：
已通过 command runner 把指令交给外部工具的，一律视为 possibly_sent；
参数校验阶段失败的，为 `false`。这与闭源「事故驱动」的设计一致——
Codex 侧动作全是 `Promise<void>` 丢掉了这个信息，ZCode 保留它。

### 坐标与元素定位

闭源对坐标目标先做命中测试再驱动（`element_at_point` before actuation），
非元素/无 token 的点在运行时以软错误拒绝。通用实现保留这个顺序：
先解析目标，再执行；解析失败不产生副作用。

## 权限模型

不引入智谱的 Helper 信任链。权限由平台自身机制承担：

- macOS：Accessibility + Screen Recording 两项系统授权；未授权时
  `capabilities()` 如实报告，`request_access` 返回需要用户手动授权的指引
- Linux：X11 下通常无需额外授权；Wayland 见上方能力矩阵
- Windows：通常无需额外授权

`request_access` 的职责是**报告**当前授权状态与缺失项，不尝试自动提权。

## 失败路径

| 场景             | 行为                                                  |
| ---------------- | ----------------------------------------------------- |
| 外部命令不存在   | `tool_unavailable` + 安装建议，`actionSent: false`    |
| 命令超时         | `tool_timeout`，`actionSent` 按是否已写入判定         |
| 命令非零退出     | `tool_failed`，附 stderr 摘要（截断，不泄露完整输出） |
| 平台不支持该原语 | `unsupported_on_platform`，`actionSent: false`        |
| abort            | 传播 `AbortError`，不产生新副作用                     |
| 截图超过 32 MiB  | broker 侧已拒绝；runtime 侧预先限制请求区域           |

错误一律向上冒泡至 CLI 入口统一格式化；runtime 不调用 `process.exit`，
不直接写终端。

## 验收场景

1. `capabilities()` 在四类平台上返回与能力矩阵一致的结果，Wayland 下
   `pointer/keyboard` 为 `false` 且其余原语仍可用。
2. 14 个方法的参数校验全部有单测覆盖，含非法坐标、非法 windowId、
   空文本、超长文本。
3. `possibly_sent` 语义有对应用例：命令 runner 已写入 → `true`；
   校验阶段失败 → `false`。
4. `KILL_SWITCH_EXEMPT` 两项在 kill switch 生效时仍可调用。
5. 外部命令缺失、超时、非零退出三条路径各有测试，断言错误码与
   `actionSent`，不断言具体 stderr 文本。
6. `pnpm typecheck` 与 `pnpm lint` 保持基线；新增源码遵守 400 行/文件约定，
   vendored 长文件（如从闭源提取的注册表）保留原样并在 spec 中记录原因。
7. E2E：在 Linux X11 下完成「截图 → 点击坐标 → 输入文本 → 再次截图」
   的闭环，断言两次截图不同。

## 实施顺序（供后续排期，本次不实现）

1. **契约层**：`Actuator` 接口 + `CapabilitySet` 类型 + 14 个方法的参数 schema
   与错误码定义。无平台依赖，可完整单测。
2. **runtime 层**：在 Actuator 之上实现 14 个方法，含 `possibly_sent`、
   app 关联、错误归一化。用内存假 actuator 做完整单测。
3. **X11 actuator**：`xdotool` + `import` + `wmctrl` + `xclip`。这是唯一能在
   当前开发机验证的一层。
4. **macOS actuator**：`screencapture` + `osascript`/`pbcopy` + Accessibility。
   参照闭源 `buildScreenCaptureArgs` 的参数构造。
5. **Windows actuator**：PowerShell + SendInput。
6. **Wayland 能力降级**：`grim` 截图可用，输入明确报 `unsupported_on_platform`。

每层独立提交，附对应测试。
