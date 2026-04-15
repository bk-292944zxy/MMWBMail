import type { ElectronMailBridge } from "@/lib/electron/ipc-contract";

declare global {
  interface Window {
    maximailDesktop?: ElectronMailBridge;
  }
}

export {};
