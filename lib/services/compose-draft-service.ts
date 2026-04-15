import { prisma } from "@/lib/prisma";
import { getLocalOwnerId } from "@/lib/local-owner";
import { ServiceError } from "@/lib/services/service-error";
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
