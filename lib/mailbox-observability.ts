type MailboxDebugEventLevel = "debug" | "warn" | "error";

export type MailboxDebugEvent = {
  id: number;
  at: string;
  event: string;
  level: MailboxDebugEventLevel;
  payload: unknown;
};

export type MailboxDebugSnapshotMap = Record<string, unknown>;

type MailboxDebugBridge = {
  enabled: boolean;
  events: MailboxDebugEvent[];
  latest: MailboxDebugSnapshotMap;
  enable: () => void;
  disable: () => void;
  clear: () => void;
};

declare global {
  interface Window {
    __MMWBMAIL_MAILBOX_DEBUG__?: MailboxDebugBridge;
  }
}

const MAILBOX_DEBUG_SESSION_KEY = "mmwbmail-mailbox-debug";
const MAILBOX_DEBUG_MAX_EVENTS = 250;

function isMailboxDebugAvailable() {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

function readEnabledFlag() {
  if (!isMailboxDebugAvailable()) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(MAILBOX_DEBUG_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabledFlag(enabled: boolean) {
  if (!isMailboxDebugAvailable()) {
    return;
  }

  try {
    if (enabled) {
      window.sessionStorage.setItem(MAILBOX_DEBUG_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(MAILBOX_DEBUG_SESSION_KEY);
    }
  } catch {
    // Ignore storage failures in dev observability mode.
  }
}

function ensureMailboxDebugBridge() {
  if (!isMailboxDebugAvailable()) {
    return null;
  }

  if (!window.__MMWBMAIL_MAILBOX_DEBUG__) {
    window.__MMWBMAIL_MAILBOX_DEBUG__ = {
      enabled: readEnabledFlag(),
      events: [],
      latest: {},
      enable() {
        this.enabled = true;
        writeEnabledFlag(true);
      },
      disable() {
        this.enabled = false;
        writeEnabledFlag(false);
      },
      clear() {
        this.events.length = 0;
        this.latest = {};
      }
    };
  }

  return window.__MMWBMAIL_MAILBOX_DEBUG__;
}

export function isMailboxDebugEnabled() {
  const bridge = ensureMailboxDebugBridge();
  return Boolean(bridge?.enabled);
}

export function recordMailboxDebugEvent(
  event: string,
  payload: unknown,
  options?: {
    level?: MailboxDebugEventLevel;
    snapshotKey?: string;
  }
) {
  const bridge = ensureMailboxDebugBridge();
  if (!bridge) {
    return;
  }

  // Performance guard: when mailbox debug mode is not enabled, skip
  // event allocation/storage entirely.
  if (!bridge.enabled) {
    return;
  }

  const entry: MailboxDebugEvent = {
    id: bridge.events.length > 0 ? bridge.events[bridge.events.length - 1]!.id + 1 : 1,
    at: new Date().toISOString(),
    event,
    level: options?.level ?? "debug",
    payload
  };

  bridge.events.push(entry);
  if (bridge.events.length > MAILBOX_DEBUG_MAX_EVENTS) {
    bridge.events.splice(0, bridge.events.length - MAILBOX_DEBUG_MAX_EVENTS);
  }

  if (options?.snapshotKey) {
    bridge.latest[options.snapshotKey] = payload;
  }

  const prefix = `[mailbox:${entry.event}]`;
  if (entry.level === "warn") {
    console.warn(prefix, payload);
    return;
  }

  if (entry.level === "error") {
    console.error(prefix, payload);
    return;
  }

  console.debug(prefix, payload);
}

export function updateMailboxDebugSnapshot(snapshotKey: string, payload: unknown) {
  recordMailboxDebugEvent(`snapshot:${snapshotKey}`, payload, {
    snapshotKey
  });
}
