import { NextResponse } from "next/server";

import { getCronSecret } from "@/lib/env";

type CronLockState = {
  locks: Set<string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mmwbmailCronLocks: CronLockState | undefined;
}

function getRuntimeState(): CronLockState {
  if (!globalThis.__mmwbmailCronLocks) {
    globalThis.__mmwbmailCronLocks = {
      locks: new Set<string>()
    };
  }

  return globalThis.__mmwbmailCronLocks;
}

function extractBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() || "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

export function authorizeAdminCronRequest(request: Request) {
  let expectedSecret = "";

  try {
    expectedSecret = getCronSecret();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CRON_SECRET is not configured.";
    return NextResponse.json(
      { error: message },
      { status: 503 }
    );
  }

  const providedSecret =
    extractBearerToken(request) ||
    request.headers.get("x-cron-secret")?.trim() ||
    new URL(request.url).searchParams.get("secret")?.trim() ||
    "";

  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Unauthorized cron invocation." },
      { status: 401 }
    );
  }

  return null;
}

export function acquireAdminCronLock(lockName: string) {
  const state = getRuntimeState();

  if (state.locks.has(lockName)) {
    return null;
  }

  state.locks.add(lockName);

  return () => {
    state.locks.delete(lockName);
  };
}
