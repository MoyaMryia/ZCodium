import type { LaunchMarks } from "@zcode/shared";

export function shouldReportLaunchToInput(state: {
  isStartupRenderBlocked: boolean;
  alreadyReported: boolean;
}): boolean {
  // 保留本地启动计时；工作区启动壳退出后只记录一次。
  return !state.alreadyReported && !state.isStartupRenderBlocked;
}

export function readRendererLaunchTimings(): {
  marks: LaunchMarks | null;
  rendererStart: number;
  reactCommit: number;
} | null {
  const w = window as Window & {
    __ZCODE_LAUNCH_MARKS__?: LaunchMarks | null;
    __ZCODE_RENDERER_START__?: number;
    __ZCODE_REACT_COMMIT_AT__?: number;
  };
  const rendererStart = w.__ZCODE_RENDERER_START__;
  const reactCommit = w.__ZCODE_REACT_COMMIT_AT__;
  if (typeof rendererStart !== "number" || typeof reactCommit !== "number") {
    return null;
  }
  return { marks: w.__ZCODE_LAUNCH_MARKS__ ?? null, rendererStart, reactCommit };
}
