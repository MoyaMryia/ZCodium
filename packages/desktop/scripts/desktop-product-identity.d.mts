export type DesktopProductFlavor = "production" | "preview";

export interface DesktopProductIdentity {
  flavor: DesktopProductFlavor;
  appId: string;
  productName: string;
  linuxExecutableName: string;
  linuxPackageName: string;
  cuaHelperInstallVariant: string | null;
}

export declare const desktopProductIdentities: Record<DesktopProductFlavor, DesktopProductIdentity>;

export declare const ZCODE_PREVIEW_IDENTITY_ENV: string;

export function isPreviewIdentityRequested(env?: Record<string, string | undefined>): boolean;
export function resolveDesktopProductFlavor(
  env?: Record<string, string | undefined>,
): DesktopProductFlavor;
export function resolveDesktopProductIdentity(
  env?: Record<string, string | undefined>,
): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: Record<string, string | undefined>): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: DesktopProductFlavor,
  runtime?: { isPackaged?: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: Record<string, string | undefined>,
  runtime?: { isPackaged?: boolean },
): string;
