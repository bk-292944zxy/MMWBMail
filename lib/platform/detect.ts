export type AppPlatform = "electron" | "capacitor" | "web";

export function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.maximailDesktop;
  return bridge?.isElectron === true && bridge?.version === 2;
}

export function isCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined;
  return cap?.isNativePlatform?.() === true;
}

export function isWeb(): boolean {
  return !isElectron() && !isCapacitor();
}

export function getAppPlatform(): AppPlatform {
  if (isElectron()) return "electron";
  if (isCapacitor()) return "capacitor";
  return "web";
}