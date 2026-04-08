import { listActiveMailAccounts } from "@/lib/mail-accounts";
import { syncMailAccount } from "@/lib/mail-sync";

type ManagedTimer = ReturnType<typeof setInterval>;

type SyncRuntimeState = {
  started: boolean;
  timers: Map<string, ManagedTimer>;
  syncing: Set<string>;
  lastRunAt: Map<string, number>;
  refreshTimer: ManagedTimer | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mmwbmailSyncRuntime: SyncRuntimeState | undefined;
}

const SYNC_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.MAIL_BACKGROUND_SYNC_INTERVAL_MS || 60_000)
);
const ACCOUNT_REFRESH_INTERVAL_MS = Math.max(
  SYNC_INTERVAL_MS,
  Number(process.env.MAIL_BACKGROUND_ACCOUNT_REFRESH_MS || 300_000)
);

function getRuntimeState(): SyncRuntimeState {
  if (!globalThis.__mmwbmailSyncRuntime) {
    globalThis.__mmwbmailSyncRuntime = {
      started: false,
      timers: new Map(),
      syncing: new Set(),
      lastRunAt: new Map(),
      refreshTimer: null
    };
  }

  return globalThis.__mmwbmailSyncRuntime;
}

function clearTimer(timer: ManagedTimer | undefined) {
  if (timer) {
    clearInterval(timer);
  }
}

async function syncAccountIfDue(accountId: string) {
  const state = getRuntimeState();

  if (state.syncing.has(accountId)) {
    return;
  }

  const lastRunAt = state.lastRunAt.get(accountId) ?? 0;
  if (Date.now() - lastRunAt < SYNC_INTERVAL_MS - 2_000) {
    return;
  }

  state.syncing.add(accountId);
  state.lastRunAt.set(accountId, Date.now());

  try {
    await syncMailAccount(accountId);
  } catch (error) {
    console.error("mmwbmail: background sync failed", {
      accountId,
      error
    });
  } finally {
    state.syncing.delete(accountId);
  }
}

async function reconcileManagedAccounts() {
  const state = getRuntimeState();
  const accounts = await listActiveMailAccounts();
  const activeIds = new Set(accounts.map((account) => account.id));

  for (const account of accounts) {
    if (state.timers.has(account.id)) {
      continue;
    }

    const timer = setInterval(() => {
      void syncAccountIfDue(account.id);
    }, SYNC_INTERVAL_MS);

    state.timers.set(account.id, timer);
    void syncAccountIfDue(account.id);
  }

  for (const [accountId, timer] of state.timers.entries()) {
    if (activeIds.has(accountId)) {
      continue;
    }

    clearTimer(timer);
    state.timers.delete(accountId);
    state.lastRunAt.delete(accountId);
    state.syncing.delete(accountId);
  }
}

export async function ensureMailSyncRuntimeStarted() {
  const state = getRuntimeState();

  if (!state.started) {
    state.started = true;

    await reconcileManagedAccounts();

    state.refreshTimer = setInterval(() => {
      void reconcileManagedAccounts().catch((error) => {
        console.error("mmwbmail: sync runtime reconcile failed", error);
      });
    }, ACCOUNT_REFRESH_INTERVAL_MS);

    return;
  }

  await reconcileManagedAccounts();
}

export async function triggerBackgroundSyncForAccount(accountId: string) {
  await ensureMailSyncRuntimeStarted();
  await syncAccountIfDue(accountId);
}

export async function syncAllActiveAccounts() {
  const accounts = await listActiveMailAccounts();

  const results = await Promise.allSettled(
    accounts.map((account) => syncMailAccount(account.id))
  );

  return {
    attempted: accounts.length,
    succeeded: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    results
  };
}
