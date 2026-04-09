import { NextResponse } from "next/server";

import { listSyncedFolders, syncMailAccount } from "@/lib/mail-sync";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const { searchParams } = new URL(request.url);
    const shouldSync = searchParams.get("sync") === "true";
    const folderPaths = searchParams
      .getAll("folder")
      .map((value) => value.trim())
      .filter(Boolean);

    if (shouldSync) {
      await syncMailAccount(accountId, folderPaths.length > 0 ? { folderPaths } : undefined);
    }

    const folders = await listSyncedFolders(accountId);
    return NextResponse.json({ folders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
