export const AppErrorBoundary = ({ children }) => children;
export const ZCodeIntlProvider = ({ children }) => children;
export const Button = ({ children, ...props }) => <button {...props}>{children}</button>;
export const selectBrowserFileData = async () => null;
export const playTaskNotificationSound = async () => {};
export function Root(props) {
  window.webEntryFixture = {
    workspacePath: props.initialWorkspaceAbsPath,
    workspaceIdentity: props.initialWorkspaceIdentity,
    hasCredentials: typeof props.services.credentialService.load === "function",
    hasOfficialOAuth: "oauthService" in props.services,
  };
  return <div>Local workspace ready</div>;
}
