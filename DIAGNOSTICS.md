# 本地诊断与可选 OTLP

ZCodium 默认不向外部发送诊断。官方上报 SDK、专有事件上传、设备归因和自动模型请求/响应录制已移除。

## 本地排障

诊断保留启动和数据库阶段、进程退出与错误分类、请求/工具/首字延迟、重试与停顿、CPU/内存和缓存计数。调用关联使用本次运行的随机诊断标识，记录顺序及父子关系。生产环境保留低频事件，高频细节遵守 debug 门控。

日志不保存提示词、对话或文件内容、命令参数、凭据、账号、真实工作区路径、完整 URL、原始错误文本及内存 dump。错误保留固定分类、系统错误码和应用代码位置。无法从安全信息定位的问题，需要用户主动提供最小复现材料。

新日志位于各日志目录下的 `diagnostics-v1`，按日分段并限制大小。桌面日志导出只读取该目录，再次校验记录；旧日志、配置、模型 I/O 和 dump 不进入归档。业务历史与用户主动打开/转换文件遵守对应功能规则，不作为诊断录制。

## 自己的接收端

配置必须同时满足：

- `ZCODE_DIAGNOSTICS_EXPORT_ENABLED=1`
- `OTEL_EXPORTER_OTLP_ENDPOINT` 为用户自己的 HTTP(S) 接收地址，或用 `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` 指定完整日志接收 URL。

通用地址会追加 `/v1/logs`。仅设置 OTEL 地址或旧上报变量不会启用导出。没有默认接收地址；停用开关并重启后不创建导出队列、定时器或网络请求。

例如，已运行本机 Collector 时，Linux 开发启动可使用：

```bash
ZCODE_DIAGNOSTICS_EXPORT_ENABLED=1 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
pnpm dev:desktop
```

Windows PowerShell：

```powershell
$env:ZCODE_DIAGNOSTICS_EXPORT_ENABLED = "1"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
pnpm dev:desktop
```

接收端使用标准 **OTLP/HTTP JSON Logs**。技术事件名为 body，阶段、耗时及计数为属性，随机 trace/span 标识用于关联；测量提供发生时间时保留该时间，同时记录观察时间。它不自动采集完整分布式调用链。资源只标识应用，不探测主机、用户、设备或命令行，不附加 `OTEL_RESOURCE_ATTRIBUTES`。

需要鉴权时可通过启动环境设置 `OTEL_EXPORTER_OTLP_HEADERS` 或 `OTEL_EXPORTER_OTLP_LOGS_HEADERS`，格式为逗号分隔的 `key=value`，值使用 URL 编码。这些配置不会进入日志、诊断 payload 或工具子进程。

桌面仅由 Main 持有出口，嵌入式 Agent 经现有 IPC 提交安全记录；独立 CLI 持有自己的出口。队列有上限，请求有超时，失败批次丢弃且只提示固定状态/数量；不保存待上传文件。日志导出不影响任务执行。

## 修改诊断代码

新增事件和指标先修改 `.agents/specs/local-diagnostics.md` 与 `packages/shared/src/diagnostics.ts` 的固定字段。调用现有 logger，并在 console、文件、IPC 边界使用 `safeLogArgs`。自由文本和业务身份不能绕过过滤。

静态消息目录由源码生成，修改日志文字后执行：

```bash
node scripts/diagnostic-log-catalog.mjs
pnpm exec oxfmt packages/shared/src/diagnosticLogCatalog.ts
node --test --test-isolation=none scripts/ci/*.test.mjs
```
