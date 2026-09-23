# @zcode/zcode-cua

ZCode 侧的 Computer Use 运行时适配器。原生执行层复用唯一一个开源项目
[`trycua/cua`](https://github.com/trycua/cua) 的 `@trycua/cua-driver`
（MIT，Rust，macOS / Windows / Linux）。

`createComputerUseRuntime({ client })` 把 driver 接到 ZCode 的
`ComputerUseRuntime` 端口上。client 由上层注入（同进程 TS SDK、daemon
`connect()`、MCP proxy 或测试假件），本包不实现任何平台逻辑，也不缓存窗口、
坐标与剪贴板。

没有注入 client 时，运行时**保持 fail-closed**：每次调用返回一条可操作的错误，
绝不伪造成功。broker RPC、Helper install/launch/verify、PiP session 等旧
接口仍为 API-compatible 占位，权限端口保持 fail-closed 语义。

设计与迁移边界见 [`.agents/specs/computer-use-runtime.md`](../../.agents/specs/computer-use-runtime.md)。

测试：`pnpm --filter @zcode/zcode-cua test`。

License: Apache-2.0.
