# Debug 离线查看边界

debug 包只读取用户选择的本地日志、会话事件文件和现有会话数据库，提供 Trace、甘特图、上下文与缓存分析。查看器不改变 Agent 执行，不写回会话数据库。

不得启动 MITM 代理、生成抓包 CA、读取或缓存实时请求/响应头与正文，也不提供抓包配置、状态、请求列表或 SSE API。旧抓包环境变量不能重新启用已移除的实现。

server 的 sources/analyzer 仍是离线文件读取与分析的唯一所有者；observation-events 仅通知已有文件变化。UI 通过现有 traces API 与 observation SSE 更新离线投影，不创建第二份实时网络请求状态。甘特图只读取服务端返回的离线 spans。

验收：健康接口和离线 trace 列表/详情继续可用；旧抓包 API 返回 404，开发/生产入口均不初始化代理；构建不包含抓包实现和 http-mitm-proxy 依赖；界面只提供 Trace 与甘特图，旧 #network 导航回 Trace。通过类型检查、Lint、构建与可用的离线 API/UI 场景验证。
