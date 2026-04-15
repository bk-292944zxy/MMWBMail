import { NextResponse } from "next/server";

import {
  deleteAccountService,
  getAccountService,
  updateAccountService
} from "@/lib/services/account-management-service";
import {
  getServiceErrorMessage,
  getServiceErrorStatus
} from "@/lib/services/service-error";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await getAccountService(accountId);

    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to load account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as {
      makeDefault?: boolean;
    };
    const account = await updateAccountService(accountId, payload);

    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to update account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const result = await deleteAccountService(accountId);

    return NextResponse.json({
      success: true,
      deletedAccountId: result.deletedAccountId,
      nextAccountId: result.nextAccountId
    });
  } catch (error) {
    return NextResponse.json(
      { error: getServiceErrorMessage(error, "Unable to delete account.") },
      { status: getServiceErrorStatus(error) }
    );
  }
}
