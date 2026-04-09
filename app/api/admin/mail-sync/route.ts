import { NextResponse } from "next/server";

import {
  acquireAdminCronLock,
  authorizeAdminCronRequest
} from "@/lib/admin-cron";
import { syncAllActiveAccounts } from "@/lib/mail-sync-runtime";

export const runtime = "nodejs";

// Internal route: intended for cron-triggered or explicitly requested sync execution.
export async function GET(request: Request) {
  const unauthorizedResponse = authorizeAdminCronRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const releaseLock = acquireAdminCronLock("mail-sync");
  if (!releaseLock) {
    return NextResponse.json(
      { error: "Mail sync is already running." },
      { status: 409 }
    );
  }

  try {
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
  } finally {
    releaseLock();
  }
}
