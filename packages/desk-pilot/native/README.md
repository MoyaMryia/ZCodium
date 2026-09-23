# surface-daemon

DeskPilot 的原生执行进程。**这是整个 DeskPilot 里唯一碰平台 FFI 的地方。**

产品规则见 [`.agents/specs/desk-pilot.md`](../../../../../../.agents/specs/desk-pilot.md)，
TS 侧契约见 [`../src/contract.ts`](../../src/contract.ts)。

## 结构

```text
native/
  Cargo.toml                        workspace
  crates/
    surface-contract/               只有数据类型，没有平台代码
      src/ui_map.rs                 对应 src/ui-map.ts
      src/actuation.rs              对应 src/actuation.ts
      src/errors.rs                 对应 src/errors.ts + 线协议信封
    surface-backend/                平台端口 + 四个后端
      src/lib.rs                    SurfaceBackend trait（12 方法）+ BackendError
      src/backends/mod.rs           运行时后端选择
      src/backends/win32.rs          UIA + Win.Graphics.Capture + SendInput
      src/backends/darwin.rs         AX + ScreenCaptureKit + CGEvent(CGEventPostToPid)
      src/backends/linux_x11.rs      AT-SPI + XTest + XGetImage
      src/backends/linux_wayland.rs  AT-SPI + libei/wlr-virtual-input + PipeWire
    surface-daemon/                 bin：JSONL server + dispatch + lifecycle
  build.mjs                         跨平台构建 + sha256 manifest
```

## 为什么 trait 是同步的

`SurfaceBackend` 不用 `async fn in trait`：daemon 在 `tokio` 里用
`spawn_blocking` 包一层。少一层 `Box<dyn Future>` 装箱，也允许后端安全地持有
非 `Send` 的平台句柄（COM apartment、ObjC 关联对象）。

## 后端选择

Linux 上跑哪个后端是**运行时**决定的，不是编译期：

```text
XDG_SESSION_TYPE=wayland 或 WAYLAND_DISPLAY 存在  → linux_wayland
DISPLAY 存在或 XDG_SESSION_TYPE=x11               → linux_x11
都没有                                            → 能力全关的后端（诚实失败）
```

顺序很重要：同一台机器上 `DISPLAY` 与 `WAYLAND_DISPLAY` 可能同时存在（XWayland），
选错后端会让输入只到 X11 客户端，原生 Wayland 应用完全收不到。

Windows 与 macOS 各自只有一个后端，`#[cfg(target_os)]` 在编译期排除另一个。

## Wayland 的立场

Wayland 禁止合成输入是**组合器的设计决策，不是缺陷**。因此：

- 输入只走 `libei`（RemoteDesktop portal，需用户授权）或 wlroots 虚拟输入协议；
- 不引入 `/dev/uinput` / `ydotool` 提权方案；
- 两条路都不可用时 `pointer=false`、`keyboard=false`，调用返回
  `UNSUPPORTED_ON_PLATFORM`，`possibly_sent=false`；
- 剪贴板读不可用时返回 `note` 说明原因，**不返回空字符串冒充成功**。

## 当前状态

接口与能力声明已完整；四个后端的**实现**尚未落地（每个未实现的方法返回
`BackendError::not_implemented`，除 `capabilities` / `request_access` / `shutdown` 外）。
实施顺序见 spec 的「实施顺序」表：P2 win32 + darwin，P3 linux-x11，P4 linux-wayland。

本开发环境没有 Rust 工具链，因此 `cargo check` 未在此处执行；`Cargo.toml` 里的
平台依赖 feature 集合需要在 P2 首次真实构建时逐个收紧。

## 构建

```sh
cd packages/desk-pilot/native
node build.mjs            # 构建所有目标，写 runtime-manifest.json
node build.mjs --clean    # 清理 dist 与 manifest
```

环境变量（daemon 运行时）：

| 变量                      | 用途                                             |
| ------------------------- | ------------------------------------------------ |
| `DESK_PILOT_SOCKET`       | Unix socket 路径 / Windows named pipe 名（必填） |
| `DESK_PILOT_LAUNCHER_PID` | 宿主 pid；宿主消失时 daemon 自杀                 |
| `DESK_PILOT_IDLE_EXIT_MS` | 空闲退出毫秒数，默认 15 分钟                     |
| `DESK_PILOT_LOG`          | `tracing` 过滤器，默认 `info`                    |
