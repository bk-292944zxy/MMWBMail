import { NextResponse } from "next/server";

import {
  ensureMailSyncRuntimeStarted,
  syncAllActiveAccounts
} from "@/lib/mail-sync-runtime";

export const runtime = "nodejs";

// Internal route: protect this before exposing publicly or rely on trusted cron invocation only.
export async function GET() {
  try {
    await ensureMailSyncRuntimeStarted();
    const result = await syncAllActiveAccounts();

    return NextResponse.json({
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync active accounts.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
