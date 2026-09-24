import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const {
  shouldBlockRootRender,
  shouldShowRootStartupLoading,
  shouldOpenFallbackWorkspaceAfterCreate,
} = await tsImport("../../packages/ui/src/lib/rootStartupGate.ts", import.meta.url);
const { shouldReportLaunchToInput } = await tsImport(
  "../../packages/ui/src/lib/diagnostics/launchTiming.ts",
  import.meta.url,
);

test("startup shell waits only for workspace restoration and initial directory creation", () => {
  for (const isRestoring of [false, true])
    for (const isBootstrappingInitialWorkspace of [false, true]) {
      const state = { isRestoring, isBootstrappingInitialWorkspace };
      assert.equal(shouldBlockRootRender(state), isRestoring || isBootstrappingInitialWorkspace);
      assert.equal(
        shouldShowRootStartupLoading({ ...state, isDesktop: true }),
        isRestoring || isBootstrappingInitialWorkspace,
      );
      assert.equal(
        shouldShowRootStartupLoading({ ...state, isDesktop: false }),
        false,
        "Web keeps its own paired-entry loading surface",
      );
    }
});

test("late default directory creation never steals a restored or newly opened workspace", () => {
  assert.equal(
    shouldOpenFallbackWorkspaceAfterCreate({ isMounted: true, activeWorkspacePath: null }),
    true,
  );
  assert.equal(
    shouldOpenFallbackWorkspaceAfterCreate({ isMounted: true, activeWorkspacePath: "/restored" }),
    false,
  );
  assert.equal(
    shouldOpenFallbackWorkspaceAfterCreate({ isMounted: false, activeWorkspacePath: null }),
    false,
  );
});

test("safe local startup timing is emitted once after the startup shell leaves", () => {
  assert.equal(
    shouldReportLaunchToInput({ isStartupRenderBlocked: true, alreadyReported: false }),
    false,
  );
  assert.equal(
    shouldReportLaunchToInput({ isStartupRenderBlocked: false, alreadyReported: false }),
    true,
  );
  assert.equal(
    shouldReportLaunchToInput({ isStartupRenderBlocked: false, alreadyReported: true }),
    false,
  );
});
