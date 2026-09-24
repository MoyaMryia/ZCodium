import {
  createFailClosedAccountProviderConfigSnapshot,
  type AccountProviderConfigSnapshot,
  type ProviderConfigSnapshot,
  type ProviderSource,
} from "./sources.js";

/** 仅从本地配置派生不可用的旧账号条目，不读取凭据或查询账号服务。 */
export class EmptyAccountProviderConfigSource implements ProviderSource<AccountProviderConfigSnapshot> {
  constructor(readonly configSource: ProviderSource<ProviderConfigSnapshot>) {}

  async read(): Promise<AccountProviderConfigSnapshot> {
    // 固定初始 revision 会在 Built-in 更新后卡住 Registry 的版本屏障，
    // 因此每次与配置一起读取；跨读取时发生变化仍交给 Registry 拒绝过时结果。
    return createFailClosedAccountProviderConfigSnapshot(await this.configSource.read());
  }

  onDidChange(): () => void {
    // ConfigSource 已由 Registry 订阅，此派生值没有第二个变更所有者。
    return () => {};
  }
}
