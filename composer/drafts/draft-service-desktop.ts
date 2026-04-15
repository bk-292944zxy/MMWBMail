import type {
  LoadDraftInput,
  LoadDraftResult,
  MarkLocalDirtyInput,
  RecoverDraftInput,
  RecoverDraftResult,
  SaveDraftInput,
  SaveDraftResult
} from "@/composer/drafts/draft-types";
import type { DraftService } from "@/composer/drafts/draft-service";
import {
  createDraftIpcClient,
  deleteDraftIpcClient,
  isElectronDraftIpcAvailable,
  loadDraftIpcClient,
  saveDraftIpcClient
} from "@/lib/electron/renderer-draft-client";

function logDraftDesktop(prefix: string, payload: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  const isDebugTraceEnabled =
    new URLSearchParams(window.location.search).get("debugDraftRestoreTrace") === "1";
  if (!isDebugTraceEnabled) {
    return;
  }

  try {
    console.info(`${prefix} ${JSON.stringify(payload)}`);
  } catch {
    console.info(`${prefix} [unserializable]`);
  }
}

export function createDesktopDraftService(fallback: DraftService): DraftService {
  const revisionState = new Map<
    string,
    { localRevision: number; lastSavedRevision: number }
  >();

  const syncStatus = (draftId: string, localRevision: number, lastSavedRevision: number) => {
    revisionState.set(draftId, { localRevision, lastSavedRevision });
  };

  const shouldUseIpc = () => isElectronDraftIpcAvailable();

  return {
    async loadDraft(input: LoadDraftInput): Promise<LoadDraftResult> {
      if (!shouldUseIpc()) {
        logDraftDesktop("[DRAFT_LOAD]", {
          stage: "desktop-service-fallback-load",
          draftId: input.draftId ?? null
        });
        return await fallback.loadDraft(input);
      }

      const result = await loadDraftIpcClient({ draftId: input.draftId ?? null });
      if (result.draft) {
        logDraftDesktop("[DRAFT_LOAD]", {
          stage: "desktop-service-ipc-load",
          draftId: result.draft.draftId,
          restoredTextBody: result.draft.textBody ?? null,
          restoredHtmlBody: result.draft.htmlBody ?? null
        });
        syncStatus(result.draft.draftId, result.draft.localRevision, result.draft.lastSavedRevision);
        return result;
      }

      const legacyResult = await fallback.loadDraft(input);
      if (!legacyResult.draft) {
        return result;
      }
      logDraftDesktop("[DRAFT_LOAD]", {
        stage: "desktop-service-legacy-fallback-load",
        draftId: legacyResult.draft.draftId,
        restoredTextBody: legacyResult.draft.textBody ?? null,
        restoredHtmlBody: legacyResult.draft.htmlBody ?? null
      });

      syncStatus(
        legacyResult.draft.draftId,
        legacyResult.draft.localRevision,
        legacyResult.draft.lastSavedRevision
      );

      if (legacyResult.draft.accountId) {
        try {
          await saveDraftIpcClient({
            storageKey: input.storageKey,
            requestId: 0,
            draft: {
              ...legacyResult.draft,
              lastSavedRevision: legacyResult.draft.lastSavedRevision
            }
          });
          await fallback.clearDraft(input.storageKey, legacyResult.draft.draftId);
        } catch {
          // Keep legacy fallback data untouched if migration fails.
        }
      }

      return legacyResult;
    },
    async saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
      if (!shouldUseIpc()) {
        logDraftDesktop("[DRAFT_SAVE]", {
          stage: "desktop-service-fallback-save",
          draftId: input.draft.draftId,
          accountId: input.draft.accountId ?? null,
          textBody: input.draft.textBody ?? null,
          htmlBody: input.draft.htmlBody ?? null,
          composeBodyAtSave: input.draft.textBody ?? null
        });
        return await fallback.saveDraft(input);
      }

      const client =
        input.requestId === 0 ? createDraftIpcClient : saveDraftIpcClient;
      logDraftDesktop("[DRAFT_SAVE]", {
        stage: "desktop-service-ipc-save",
        draftId: input.draft.draftId,
        accountId: input.draft.accountId ?? null,
        textBody: input.draft.textBody ?? null,
        htmlBody: input.draft.htmlBody ?? null,
        composeBodyAtSave: input.draft.textBody ?? null
      });
      const result = await client(input);
      syncStatus(result.draft.draftId, result.draft.localRevision, result.draft.lastSavedRevision);
      return result;
    },
    markLocalDirty(input: MarkLocalDirtyInput) {
      if (!shouldUseIpc()) {
        fallback.markLocalDirty(input);
        return;
      }

      const current = revisionState.get(input.draftId) ?? {
        localRevision: 0,
        lastSavedRevision: 0
      };
      revisionState.set(input.draftId, {
        ...current,
        localRevision: input.localRevision
      });
    },
    getDraftStatus(draftId: string) {
      if (!shouldUseIpc()) {
        return fallback.getDraftStatus(draftId);
      }

      const state = revisionState.get(draftId);
      if (!state) {
        return null;
      }

      return { draftId, ...state };
    },
    async recoverDraft(input: RecoverDraftInput): Promise<RecoverDraftResult> {
      return await this.loadDraft(input);
    },
    async clearDraft(storageKey: string, draftId?: string | null): Promise<void> {
      if (!shouldUseIpc()) {
        await fallback.clearDraft(storageKey, draftId);
        return;
      }

      if (!draftId) {
        await fallback.clearDraft(storageKey, draftId);
        return;
      }

      await deleteDraftIpcClient({ draftId });
      await fallback.clearDraft(storageKey, draftId);
      revisionState.delete(draftId);
    }
  };
}
