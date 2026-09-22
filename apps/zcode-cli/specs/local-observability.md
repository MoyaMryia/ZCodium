# CLI 本地诊断边界

CLI 默认不创建外部诊断出口，不采集安装标识用于模型请求归因。独立 CLI 仅在用户显式启用并提供自有 OTLP endpoint 时持有一个标准诊断 exporter；桌面协议进程只通过严格 schema 的 process/safeDiagnostic 通知送 Main，复用 Main 的唯一出口。保留用于本地排障和性能分析的 agent/model/tool 执行关联、耗时、错误与资源信息；本地事件和 span 的保留与否由实际诊断用途决定，不由命名决定。历史专有上报环境变量不能开启任何外部报送路径。

业务执行由现有 runtime、CommandInbox、工具权限系统与模型 adapter 持有状态；删除观察旁路不改变命令 admission、重试预算、取消、队列或终态事件。业务 `traceId`、session/turn/request 关联继续服务于业务协议与 owner 内存关联；日志使用独立随机诊断身份。模型错误分类、重试状态与 token/cost 数据属于模型契约。

工具耗时与首字延迟用于本地诊断，安全记录可经用户显式启用的 OTLP 出口发送。资源管理器通过按需子进程查询读取运行资源；CPU、内存、Bash/MCP 资源测量和聚合在具有本地排障或开发消费路径时保留，不保留仅服务于专有上报的定时推送。会话清理和本地内存日志保留原 60 秒节拍。首字延迟由本地 recorder 从业务事件计算；Desktop continuous 与 Web replayable 继续复用同一业务事件所有者。本地测量应保持低开销、幂等和生命周期清理，不收集原始输入或模型内容到诊断，默认不外发诊断记录。

```text
CommandInbox → runtime → SessionEvent → Desktop / Web
                    └→ 本地日志与诊断
```

验收：模型请求、工具调用、取消与重试仍发送原有业务事件；无专有遥测初始化/flush/shutdown；不生成或传输持久设备标识；本地首字延迟在 turn、model request 与输出事件后仍能完成。

CUA 权限提示是业务副作用：live ingest 保持原投递时机，并以 `sessionId + eventId` 在有界集合内去重；不同 session 的同号事件互不抑制。移除遥测不得移除该幂等边界。会话活动通知仅携带 sessionId 与 running/idle，沿同一业务事件序列投递，历史回放与重复事件不能重新触发活动变化。

AskUserQuestion 的模型输入仅包含问题、回答与可视预览批注，不暴露仅用于分析归因的 metadata.source 字段。

本地诊断采样由原进程 owner 持有：Bash 每条命令独占有界采样并在退出时封口；MCP tracker 管理 owner、进程树、孤儿与崩溃关联，关闭时停止采样；CLI 60 秒采样复用维护节拍。摘要通过既有 stdio 协议送至 Host/Main 的本地诊断消费者；本地 IPC 不是外部上报。迟到采样不得修改已完成命令，观察异常不得影响执行或维护。

模型首次 provider event/content/text 在发生时写本地 debug，失败或取消前也能定位流式停滞阶段；这些纯观测里程碑不进入业务 SessionEvent 或请求治理器。独立操作（标题、目标验证、记忆提取等）以关联上下文、耗时与终态写本地日志，不记录输入内容。会话监督器所需无正文事实保持原 live 去重边界与本地通知，不进入回放。

追加验收：资源摘要仍有本地消费，采样 start/stop 幂等、命令完成后的迟到结果被忽略；诊断通知发送失败不阻断 60 秒维护；模型里程碑不投递业务 sink；本地独立操作诊断覆盖成功、失败和取消。

维护节拍回归必须同步推进定时器与资源采样的单调时钟，不依赖测试宿主的实际运行耗时；即使真实时间没有流逝，模拟 60 秒后仍能验证采样、维护顺序和关闭后的停止行为。生产采样继续拒绝零或负的测量间隔。

隐私边界：不创建模型输入/输出诊断副本；业务所需模型响应解析、会话历史与工具参数继续由业务 owner 使用。诊断不采集 provider 地址、自定义模型/插件/技能名、命令和路径指纹、原始错误全文或任意 metadata。只保留技术时序、数值、固定状态/错误类别；原始业务关联 ID 只在 owner 内临时关联，日志输出由统一诊断边界转换为当次运行随机关联。模型 response body 的暂存只允许用于套餐错误识别与执行恢复，不进入日志记录。

中央 Logger 在同步入口通过 shared.safeLogArgs 生成安全副本，仅安全副本进入异步有界写队列、console 和诊断 sink；新记录存入 diagnostics-v1 独立目录。关联ID由 factory/child 在运行内随机生成，不导出原 session/request/trace 身份。factory.flush 与独立 CLI exporter.shutdown 在统一退出边界收口；协议关闭不创建独立出口。

日志写盘按日最多 4 段，每段 10 MiB；轮转使用现有跨进程文件锁，多个 CLI 不得绕过容量限制。达到当日 4 段后丢弃需额外轮转的 debug，info/warn/error 继续替换最旧段；轮转段沿用 7 天保留清理。单条过大记录和写队列超限均丢弃，不阻断业务。每条诊断 record 使用独立随机 spanId，稳定 logger 随机上下文只作 parentSpanId。

开发工具 `prompt-trajectory` 只接受用户显式指定的既有文件并离线转换。删除 record/record:prompt、provider 代理、live response 汇集、录制 ledger 和录制配置/凭据入口；derive 与 model-io 都要求 --input，不创建网络监听、不访问模型端点。保留已有文件的分段、消息连续性与 Anthropic 格式转换。验收：旧录制命令被拒绝，离线 fixture 可成功生成转换结果，工具源码无网络/录制依赖。

直接诊断出口遵循同一隐私边界：console（含第三方调用）、CLI/REPL 未捕获异常和启动错误仅输出 safeLogArgs 与应用源码白名单栈位置，不输出原错误全文或自定义工具名。进程异常保持原结构化协议、单次 fatal 与退出顺序；正常 CLI 结果、工具 stdout 和业务持久化不经过诊断净化。开发 debug 服务删除 live 网络代理、请求响应捕获、CA 与相关面板，保留既有会话数据的读取分析。验收使用含正文/路径/凭据的 sentinel 验证直接诊断不可泄露，且异常通知与关闭保持幂等。

子代理只写 TaskOutput 所需的执行结果与既有会话存储；不重复生成无人读取的 metadata.json（prompt、profile、cwd、业务身份副本）。完成、失败、停止和恢复路径使用相同边界，不引入虚假的写文件失败回滚。Hook 显式执行所需临时 transcript 输入按原契约使用并清理，不属于诊断记录。

TUI 的第三方 stderr 屏障只抑制破坏终端布局的输出，不缓存和回放未经净化的原文；命令自身使用 passthrough 输出正常结果。

进程异常与 console 安全边界覆盖协议、TUI、headless 和 plugin-host；plugin-host 建连后 main 返回不等于进程退出，安全边界必须保留到服务真正关闭。
