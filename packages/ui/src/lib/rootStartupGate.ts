interface RootStartupGateState {
  isRestoring: boolean;
  isBootstrappingInitialWorkspace: boolean;
}

interface RootStartupLoadingVisibilityState extends RootStartupGateState {
  isDesktop: boolean | undefined;
}

interface FallbackWorkspaceCreateState {
  isMounted: boolean;
  activeWorkspacePath: string | null;
}

export function shouldBlockRootRender(state: RootStartupGateState): boolean {
  return state.isRestoring || state.isBootstrappingInitialWorkspace;
}

export function shouldShowRootStartupLoading(state: RootStartupLoadingVisibilityState): boolean {
  return Boolean(state.isDesktop) && shouldBlockRootRender(state);
}

export function shouldOpenFallbackWorkspaceAfterCreate(
  state: FallbackWorkspaceCreateState,
): boolean {
  return state.isMounted && !state.activeWorkspacePath;
}
