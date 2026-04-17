type DesktopBridgeShape = {
  isElectron?: boolean;
  version?: number;
};

type CapacitorBridgeShape = {
  isNativePlatform?: () => boolean;
};

export type AppPlatform = "electron" | "capacitor" | "web";

function getBrowserWindow():
  | (Window &
      typeof globalThis & {
        maximailDesktop?: DesktopBridgeShape;
        Capacitor?: CapacitorBridgeShape;
      })
  | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window &
        typeof globalThis & {
          maximailDesktop?: DesktopBridgeShape;
          Capacitor?: CapacitorBridgeShape;
        });
}

export function isElectron(): boolean {
  const w = getBrowserWindow();
  return (
    w?.maximailDesktop?.isElectron === true &&
    w?.maximailDesktop?.version === 2
  );
}

export function isCapacitor(): boolean {
  const w = getBrowserWindow();
  return w?.Capacitor?.isNativePlatform?.() === true;
}

export function isWeb(): boolean {
  return !isElectron() && !isCapacitor();
}

export function getAppPlatform(): AppPlatform {
  if (isElectron()) return "electron";
  if (isCapacitor()) return "capacitor";
  return "web";
}