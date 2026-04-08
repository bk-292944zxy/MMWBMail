import { NextResponse } from "next/server";

import {
  deleteMailAccount,
  getMailAccount,
  setDefaultMailAccount
} from "@/lib/mail-accounts";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await getMailAccount(accountId);

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as {
      makeDefault?: boolean;
    };

    if (payload.makeDefault) {
      await setDefaultMailAccount(accountId);
    }

    const account = await getMailAccount(accountId);

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const result = await deleteMailAccount(accountId);

    return NextResponse.json({
      success: true,
      deletedAccountId: result.deletedAccountId,
      nextAccountId: result.nextAccountId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
