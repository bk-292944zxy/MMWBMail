import { NextResponse } from "next/server";

import { syncAccountOnDemand } from "@/lib/mail-sync-runtime";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type SyncPayload = {
  folderPaths?: string[];
  includeBodies?: boolean;
};

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json().catch(() => ({}))) as SyncPayload;
    const { accountId } = await context.params;
    const result = await syncAccountOnDemand(accountId, {
      folderPaths: Array.isArray(payload.folderPaths) ? payload.folderPaths : undefined,
      includeBodies: payload.includeBodies === true
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
