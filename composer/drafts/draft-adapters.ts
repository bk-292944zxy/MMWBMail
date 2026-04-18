import type {
  LegacyStoredDraft,
  StoredComposerDraft,
  StoredDraftAttachment
} from "@/composer/drafts/draft-types";

type StoredDraftCollection = {
  version: 3;
  activeDraftId: string | null;
  draftsById: Record<string, StoredComposerDraft>;
  updatedAt: string;
};

export interface DraftStorageAdapter {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createLocalStorageDraftAdapter(): DraftStorageAdapter {
  return {
    async load(key) {
      if (typeof window === "undefined") {
        return null;
      }

      return window.localStorage.getItem(key);
    },
    async save(key, value) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.setItem(key, value);
    },
    async remove(key) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.removeItem(key);
    }
  };
}

export async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(attachment: StoredDraftAttachment) {
  const [header, content = ""] = attachment.dataUrl.split(",");
  const mime = header.match(/^data:([^;]+);/)?.[1] ?? attachment.type;
  const binary = window.atob(content);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], attachment.name, {
    type: mime
  });
}

export function normalizeStoredDraft(
  raw: string | null
): StoredComposerDraft | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const normalizedCollection = normalizeStoredDraftCollection(raw);
  if (normalizedCollection.activeDraftId) {
    const collectionDraft = normalizedCollection.draftsById[normalizedCollection.activeDraftId];
    if (collectionDraft) {
      return collectionDraft;
    }
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version === 3
  ) {
    return null;
  }

  return normalizeStoredDraftObject(parsed as Partial<StoredComposerDraft> | LegacyStoredDraft);
}

function normalizeStoredDraftObject(
  parsed: Partial<StoredComposerDraft> | LegacyStoredDraft
): StoredComposerDraft {
  if ("version" in parsed && parsed.version === 2 && "draftId" in parsed) {
    const accountId =
      parsed.accountId ??
      parsed.composeSessionContext?.ownerAccountId ??
      parsed.composeIdentity?.ownerAccountId ??
      parsed.composeIdentity?.accountId;

    const normalizedContext = parsed.composeSessionContext
      ? {
          sessionId: parsed.composeSessionContext.sessionId ?? parsed.draftId ?? `draft-${Date.now()}`,
          ownerAccountId: parsed.composeSessionContext.ownerAccountId,
          ownerLocked: parsed.composeSessionContext.ownerLocked,
          ownerStatus: parsed.composeSessionContext.ownerStatus,
          initializationSource:
            parsed.composeSessionContext.initializationSource ??
            (parsed.composeIntent?.kind === "draft_resume"
              ? "draft_resume"
              : parsed.composeIntent?.kind ?? "draft_resume"),
          sourceAccountId:
            parsed.composeSessionContext.sourceAccountId ??
            parsed.sourceMessageMeta?.accountId ??
            null,
          sourceMessageId:
            parsed.composeSessionContext.sourceMessageId ??
            parsed.sourceMessageMeta?.messageId ??
            null,
          sourceMessageUid:
            parsed.composeSessionContext.sourceMessageUid ??
            parsed.sourceMessageMeta?.uid ??
            null
        }
      : null;

    return {
      version: 2,
      draftId: parsed.draftId ?? `draft-${Date.now()}`,
      accountId,
      composeSessionContext: normalizedContext,
      draftIdentitySnapshot: parsed.draftIdentitySnapshot ?? null,
      composeIdentity: parsed.composeIdentity ?? null,
      composeContentState: parsed.composeContentState ?? null,
      composeIntent: parsed.composeIntent,
      sourceMessageMeta: parsed.sourceMessageMeta ?? null,
      composeEvent: parsed.composeEvent ?? null,
      composeEventAttachment: parsed.composeEventAttachment ?? null,
      draftPresentation: parsed.draftPresentation ?? null,
      subject: parsed.subject ?? "",
      to: parsed.to ?? [],
      cc: parsed.cc ?? [],
      bcc: parsed.bcc ?? [],
      replyTo: parsed.replyTo ?? "",
      htmlBody: parsed.htmlBody ?? "",
      textBody: parsed.textBody ?? "",
      signature: parsed.signature ?? "",
      attachments: parsed.attachments ?? [],
      autosaveStatus: parsed.autosaveStatus ?? "saved",
      lastSavedRevision: parsed.lastSavedRevision ?? 0,
      localRevision: parsed.localRevision ?? parsed.lastSavedRevision ?? 0,
      updatedAt: parsed.updatedAt ?? parsed.savedAt ?? new Date().toISOString(),
      providerDraftId: parsed.providerDraftId ?? null,
      savedAt: parsed.savedAt ?? parsed.updatedAt ?? new Date().toISOString()
    };
  }

  const legacy = parsed as LegacyStoredDraft;
  const body = legacy.body ?? "";

  return {
    version: 2,
    draftId: `draft-${Date.now()}`,
    composeSessionContext: null,
    draftIdentitySnapshot: null,
    composeIdentity: null,
    composeContentState: null,
    composeIntent: undefined,
    sourceMessageMeta: null,
    composeEvent: null,
    composeEventAttachment: null,
    draftPresentation: null,
    subject: legacy.subject ?? "",
    to: legacy.to ?? [],
    cc: legacy.cc ?? [],
    bcc: legacy.bcc ?? [],
    replyTo: "",
    htmlBody: body,
    textBody: body.replace(/<br\s*\/?>/gi, "\n"),
    signature: "",
    attachments: [],
    autosaveStatus: "saved",
    lastSavedRevision: 0,
    localRevision: 0,
    updatedAt: legacy.savedAt ?? new Date().toISOString(),
    savedAt: legacy.savedAt ?? new Date().toISOString(),
    providerDraftId: null
  };
}

export function normalizeStoredDraftCollection(raw: string | null): {
  activeDraftId: string | null;
  draftsById: Record<string, StoredComposerDraft>;
} {
  if (!raw) {
    return {
      activeDraftId: null,
      draftsById: {}
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      activeDraftId: null,
      draftsById: {}
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version === 3
  ) {
    const collection = parsed as Partial<StoredDraftCollection>;
    const draftsById = Object.entries(collection.draftsById ?? {}).reduce<
      Record<string, StoredComposerDraft>
    >((accumulator, [draftId, draft]) => {
      if (!draft || typeof draft !== "object") {
        return accumulator;
      }

      const normalizedDraft = normalizeStoredDraftObject({
        ...(draft as Partial<StoredComposerDraft>),
        draftId
      });
      accumulator[normalizedDraft.draftId] = normalizedDraft;
      return accumulator;
    }, {});

    const activeDraftId =
      collection.activeDraftId && draftsById[collection.activeDraftId]
        ? collection.activeDraftId
        : Object.keys(draftsById)[0] ?? null;

    return {
      activeDraftId,
      draftsById
    };
  }

  const normalizedDraft = normalizeStoredDraftObject(
    parsed as Partial<StoredComposerDraft> | LegacyStoredDraft
  );

  return {
    activeDraftId: normalizedDraft.draftId,
    draftsById: {
      [normalizedDraft.draftId]: normalizedDraft
    }
  };
}
