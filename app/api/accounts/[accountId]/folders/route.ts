import { NextResponse } from "next/server";

import { listSyncedFolders, syncMailAccount } from "@/lib/mail-sync";
import { ensureMailSyncRuntimeStarted } from "@/lib/mail-sync-runtime";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureMailSyncRuntimeStarted();
    const { accountId } = await context.params;
    const { searchParams } = new URL(request.url);
    const shouldSync = searchParams.get("sync") === "true";

    if (shouldSync) {
      await syncMailAccount(accountId);
    }

    const folders = await listSyncedFolders(accountId);
    return NextResponse.json({ folders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
