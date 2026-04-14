import type {
  LegacyStoredDraft,
  StoredComposerDraft,
  StoredDraftAttachment
} from "@/composer/drafts/draft-types";

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

  const parsed = JSON.parse(raw) as Partial<StoredComposerDraft> | LegacyStoredDraft;

  if ("version" in parsed && parsed.version === 2 && "draftId" in parsed) {
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
      accountId: parsed.accountId,
      composeSessionContext: normalizedContext,
      draftIdentitySnapshot: parsed.draftIdentitySnapshot ?? null,
      composeIdentity: parsed.composeIdentity ?? null,
      composeContentState: parsed.composeContentState ?? null,
      composeIntent: parsed.composeIntent,
      sourceMessageMeta: parsed.sourceMessageMeta ?? null,
      composeEvent: parsed.composeEvent ?? null,
      composeEventAttachment: parsed.composeEventAttachment ?? null,
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
