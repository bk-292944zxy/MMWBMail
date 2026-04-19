import { prisma } from "@/lib/prisma";
import { getLocalOwnerId } from "@/lib/local-owner";
import { ServiceError } from "@/lib/services/service-error";
import { saveAccountDraft } from "@/lib/mail-account-actions";
import type {
  DraftSnapshotInput,
  SaveDraftResult,
  StoredComposerDraft
} from "@/composer/drafts/draft-types";

const DRAFT_TRACE_SERVER_ENABLED = process.env.MMWB_DRAFT_TRACE === "1";

export type ComposeDraftSavePayload = {
  storageKey: string;
  requestId: number;
  draft: DraftSnapshotInput;
};

export type ComposeDraftLoadPayload = {
  draftId?: string | null;
};

export type ComposeDraftListPayload = {
  accountId?: string | null;
};

export type ComposeDraftDeletePayload = {
  draftId: string;
};

export type ComposeDraftServerSavePayload = {
  draftId: string;
};

function resolveDraftAccountId(draft: DraftSnapshotInput) {
  const candidates = [
    draft.accountId,
    draft.composeSessionContext?.ownerAccountId,
    draft.draftIdentitySnapshot?.ownerAccountId,
    draft.composeIdentity?.sender?.accountId,
    draft.composeIdentity?.ownerAccountId,
    draft.composeIdentity?.accountId
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function toStoredDraft(draft: DraftSnapshotInput, savedAtIso: string): StoredComposerDraft {
  return {
    version: 2,
    ...draft,
    autosaveStatus: "saved",
    lastSavedRevision: draft.localRevision,
    updatedAt: savedAtIso,
    savedAt: savedAtIso
  };
}

function parseStoredDraftRecord(dataJson: string): StoredComposerDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataJson);
  } catch {
    throw new ServiceError("Stored draft data is corrupted.", 500);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ServiceError("Stored draft data is invalid.", 500);
  }

  return parsed as StoredComposerDraft;
}

async function assertOwnedAccount(userId: string, accountId: string) {
  const account = await prisma.mailAccount.findFirst({
    where: {
      id: accountId,
      userId
    },
    select: { id: true }
  });

  if (!account) {
    throw new ServiceError("Account not found.", 404);
  }
}

export async function saveComposeDraftService(
  payload: ComposeDraftSavePayload
): Promise<SaveDraftResult> {
  const userId = await getLocalOwnerId();
  const accountId = resolveDraftAccountId(payload.draft);
  if (!accountId) {
    throw new ServiceError("Draft account is required.", 400);
  }

  await assertOwnedAccount(userId, accountId);

  const composeSessionId =
    payload.draft.composeSessionContext?.sessionId?.trim() || payload.draft.draftId;
  const savedAt = new Date();
  const savedAtIso = savedAt.toISOString();
  const storedDraft = toStoredDraft(payload.draft, savedAtIso);
  if (DRAFT_TRACE_SERVER_ENABLED) {
    console.info("[DRAFT_SAVE]", {
      stage: "sqlite-upsert",
      draftId: payload.draft.draftId,
      accountId,
      textBody: storedDraft.textBody ?? null,
      htmlBody: storedDraft.htmlBody ?? null,
      composeBodyAtSave: payload.draft.textBody ?? null
    });
  }

  await prisma.composeDraft.upsert({
    where: {
      userId_draftId: {
        userId,
        draftId: payload.draft.draftId
      }
    },
    create: {
      userId,
      accountId,
      draftId: payload.draft.draftId,
      composeSessionId,
      subject: payload.draft.subject,
      dataJson: JSON.stringify(storedDraft),
      localRevision: payload.draft.localRevision,
      lastSavedRevision: storedDraft.lastSavedRevision,
      savedAt
    },
    update: {
      accountId,
      composeSessionId,
      subject: payload.draft.subject,
      dataJson: JSON.stringify(storedDraft),
      localRevision: payload.draft.localRevision,
      lastSavedRevision: storedDraft.lastSavedRevision,
      savedAt
    }
  });

  return {
    draft: storedDraft,
    requestId: payload.requestId,
    savedRevision: storedDraft.lastSavedRevision,
    savedAt: savedAtIso
  };
}

export async function loadComposeDraftService(payload: ComposeDraftLoadPayload) {
  const userId = await getLocalOwnerId();
  const draftId = payload.draftId?.trim();
  const record = await prisma.composeDraft.findFirst({
    where: draftId
      ? {
          userId,
          draftId
        }
      : {
          userId
        },
    orderBy: draftId ? undefined : { updatedAt: "desc" }
  });

  if (!record) {
    return { draft: null, raw: null };
  }

  const draft = parseStoredDraftRecord(record.dataJson);
  if (DRAFT_TRACE_SERVER_ENABLED) {
    console.info("[DRAFT_LOAD]", {
      stage: "sqlite-load",
      draftId: draft.draftId,
      restoredTextBody: draft.textBody ?? null,
      restoredHtmlBody: draft.htmlBody ?? null
    });
  }
  return {
    draft,
    raw: JSON.stringify(draft)
  };
}

export async function listComposeDraftsService(payload: ComposeDraftListPayload = {}) {
  const userId = await getLocalOwnerId();
  const accountId = payload.accountId?.trim();
  if (accountId) {
    await assertOwnedAccount(userId, accountId);
  }

  const records = await prisma.composeDraft.findMany({
    where: {
      userId,
      ...(accountId ? { accountId } : {})
    },
    orderBy: { updatedAt: "desc" }
  });

  return {
    drafts: records.map((record) => parseStoredDraftRecord(record.dataJson))
  };
}

export async function deleteComposeDraftService(payload: ComposeDraftDeletePayload) {
  const userId = await getLocalOwnerId();
  const draftId = payload.draftId?.trim();
  if (!draftId) {
    return { deleted: false };
  }

  const result = await prisma.composeDraft.deleteMany({
    where: {
      userId,
      draftId
    }
  });

  return { deleted: result.count > 0 };
}

function toCsv(values: string[] | undefined) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

export async function saveComposeDraftToServerService(
  payload: ComposeDraftServerSavePayload
) {
  const userId = await getLocalOwnerId();
  const draftId = payload.draftId?.trim();

  if (!draftId) {
    throw new ServiceError("Draft id is required.", 400);
  }

  const record = await prisma.composeDraft.findFirst({
    where: {
      userId,
      draftId
    }
  });

  if (!record) {
    throw new ServiceError("Draft not found.", 404);
  }

  const draft = parseStoredDraftRecord(record.dataJson);
  const accountId = resolveDraftAccountId(draft);
  if (!accountId) {
    throw new ServiceError("Draft account is required.", 400);
  }

  await assertOwnedAccount(userId, accountId);

  const fromAddress =
    draft.composeIdentity?.sender?.address?.trim() ||
    "";
  const fromName = draft.composeIdentity?.sender?.displayName?.trim() || "";

  const saveResult = await saveAccountDraft(
    accountId,
    {
      folder: "INBOX",
      fromAddress: fromAddress || undefined,
      fromName: fromName || undefined,
      to: toCsv(draft.to),
      cc: toCsv(draft.cc),
      bcc: toCsv(draft.bcc),
      replyTo: draft.replyTo?.trim() || draft.composeIdentity?.replyTo?.trim() || undefined,
      subject: draft.subject ?? "",
      text: draft.textBody ?? "",
      html: draft.htmlBody ?? undefined,
      attachments: []
    },
    {
      previousProviderDraftId: draft.providerDraftId ?? null
    }
  );

  const savedAt = new Date();
  const savedAtIso = savedAt.toISOString();
  const nextDraft: StoredComposerDraft = {
    ...draft,
    providerDraftId: saveResult.providerDraftId,
    updatedAt: savedAtIso,
    savedAt: savedAtIso
  };

  await prisma.composeDraft.update({
    where: {
      userId_draftId: {
        userId,
        draftId
      }
    },
    data: {
      dataJson: JSON.stringify(nextDraft),
      lastSavedRevision: nextDraft.lastSavedRevision,
      savedAt
    }
  });

  return {
    saved: true,
    providerDraftId: saveResult.providerDraftId,
    folderPath: saveResult.folderPath
  };
}
