import { NextResponse } from "next/server";

import { getOwnedAccount } from "@/lib/account-ownership";
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
    const account = await getOwnedAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

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
