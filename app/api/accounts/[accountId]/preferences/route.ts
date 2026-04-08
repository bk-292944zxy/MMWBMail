import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

type PreferencesPayload = {
  prioritizedSenders?: { name: string; email: string; color: string }[];
  autoFilters?: {
    senderName: string;
    senderEmail: string;
    keepDays: 1 | 7 | 30 | 60 | 90;
    createdAt: string;
  }[];
  blockedSenders?: string[];
};

type PreferencesRow = {
  prioritizedSenders: string;
  autoFilters: string;
  blockedSenders: string;
};

function parseJsonField<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return [] as T;
  }
}

function mapPreferences(record: {
  prioritizedSenders: string;
  autoFilters: string;
  blockedSenders: string;
}) {
  return {
    prioritizedSenders: parseJsonField<
      { name: string; email: string; color: string }[]
    >(record.prioritizedSenders),
    autoFilters: parseJsonField<
      {
        senderName: string;
        senderEmail: string;
        keepDays: 1 | 7 | 30 | 60 | 90;
        createdAt: string;
      }[]
    >(record.autoFilters),
    blockedSenders: parseJsonField<string[]>(record.blockedSenders)
  };
}

async function ensureAccountExists(accountId: string) {
  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId },
    select: { id: true }
  });

  return account;
}

async function ensurePreferencesRecord(accountId: string) {
  await prisma.$executeRaw`
    INSERT INTO "UserPreferences" (
      "id",
      "accountId",
      "prioritizedSenders",
      "autoFilters",
      "blockedSenders",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${accountId},
      ${JSON.stringify([])},
      ${JSON.stringify([])},
      ${JSON.stringify([])},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT("accountId") DO NOTHING
  `;
}

async function loadPreferencesRow(accountId: string) {
  const rows = await prisma.$queryRaw<PreferencesRow[]>`
    SELECT
      "prioritizedSenders",
      "autoFilters",
      "blockedSenders"
    FROM "UserPreferences"
    WHERE "accountId" = ${accountId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await ensureAccountExists(accountId);

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    await ensurePreferencesRecord(accountId);
    const preferences = await loadPreferencesRow(accountId);

    return NextResponse.json(
      preferences
        ? mapPreferences(preferences)
        : {
            prioritizedSenders: [],
            autoFilters: [],
            blockedSenders: []
          }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load account preferences.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function updatePreferences(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    const account = await ensureAccountExists(accountId);

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const payload = (await request.json().catch(() => ({}))) as PreferencesPayload;

    await ensurePreferencesRecord(accountId);
    const existing = await loadPreferencesRow(accountId);

    const prioritizedSenders = JSON.stringify(
      payload.prioritizedSenders ??
        (existing ? parseJsonField<PreferencesPayload["prioritizedSenders"]>(existing.prioritizedSenders) : [])
    );
    const autoFilters = JSON.stringify(
      payload.autoFilters ??
        (existing ? parseJsonField<PreferencesPayload["autoFilters"]>(existing.autoFilters) : [])
    );
    const blockedSenders = JSON.stringify(
      payload.blockedSenders ??
        (existing ? parseJsonField<PreferencesPayload["blockedSenders"]>(existing.blockedSenders) : [])
    );

    await prisma.$executeRaw`
      UPDATE "UserPreferences"
      SET
        "prioritizedSenders" = ${prioritizedSenders},
        "autoFilters" = ${autoFilters},
        "blockedSenders" = ${blockedSenders},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${accountId}
    `;

    const preferences = await loadPreferencesRow(accountId);

    return NextResponse.json(
      preferences
        ? mapPreferences(preferences)
        : {
            prioritizedSenders: [],
            autoFilters: [],
            blockedSenders: []
          }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update account preferences.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return updatePreferences(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return updatePreferences(request, context);
}
