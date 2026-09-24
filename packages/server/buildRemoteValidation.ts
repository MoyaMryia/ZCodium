export interface RemoteServerBundleValidationInput {
  bundledInputs: string[];
  source: string;
}

const unresolvedUndiciRuntimeImportPattern = /\b(?:require|import)\d*\(["']undici["']\)/;

export function validateRemoteServerBundle({
  source,
  bundledInputs,
}: RemoteServerBundleValidationInput): void {
  // JS 和原生 addon 必须同源；拒绝再次把另一个 node-pty 版本混入远端包。
  if (bundledInputs.some((path) => /(?:^|[/\\])node-pty[/\\]lib[/\\]/.test(path))) {
    throw new Error("Remote server must use the dedicated @lydell/node-pty-linux-x64 JS runtime");
  }
  const hasUnresolvedUndiciRuntimeImport = unresolvedUndiciRuntimeImportPattern.test(source);

  if (hasUnresolvedUndiciRuntimeImport) {
    // remote deploy 只会上传单个 zcode-server.cjs 到 ~/.zcodium/server/。
    // 只有 bundle 里残留裸 undici 运行时导入才说明远端还依赖 node_modules；
    // 若当前代码已经不使用 undici，则不应把“无依赖”误判成“未内联”。
    throw new Error(
      'Remote server bundle must inline undici. Found unresolved runtime dependency "undici".',
    );
  }
}
