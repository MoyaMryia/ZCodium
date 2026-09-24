import { useTabStore } from "../../../packages/ui/src/store/TabStoreProvider.js";

// 只替换重型显示叶子；Root、模型读取、TabStore/恢复和平台编排均使用产品实现。
export function RootWorkspaceContent({ workspaceShellPath, isSettingsTabActive }) {
  const addSettingsTab = useTabStore((state) => state.openSettingsTab);
  return (
    <section aria-label="Workspace ready">
      <span data-testid="workspace-path">{workspaceShellPath}</span>
      <button onClick={addSettingsTab}>Open settings</button>
      {isSettingsTabActive ? <SettingsPage /> : null}
    </section>
  );
}
export function SettingsPage() {
  return <section aria-label="Settings ready">Local settings</section>;
}
export function DiffsWorkerPoolProvider({ children }) {
  return children;
}
export function OccupationOnboarding({ children }) {
  return children;
}
export function OnboardingDialog() {
  return null;
}
export function SSHDialog() {
  return null;
}
export function DirectoryBrowser() {
  return null;
}
export function CuaPermissionObservationAttachment() {
  return null;
}
