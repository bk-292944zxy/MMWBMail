import {
  normalizeStoredDraft,
  type DraftStorageAdapter
} from "@/composer/drafts/draft-adapters";
import type {
  LoadDraftInput,
  LoadDraftResult,
  MarkLocalDirtyInput,
  RecoverDraftInput,
  RecoverDraftResult,
  SaveDraftInput,
  SaveDraftResult,
  StoredComposerDraft
} from "@/composer/drafts/draft-types";

export interface DraftService {
  loadDraft(input: LoadDraftInput): Promise<LoadDraftResult>;
  saveDraft(input: SaveDraftInput): Promise<SaveDraftResult>;
  markLocalDirty(input: MarkLocalDirtyInput): void;
  getDraftStatus(draftId: string): {
    draftId: string;
    localRevision: number;
    lastSavedRevision: number;
  } | null;
  recoverDraft(input: RecoverDraftInput): Promise<RecoverDraftResult>;
  clearDraft(storageKey: string): Promise<void>;
}

export function createDraftService(storage: DraftStorageAdapter): DraftService {
  const revisionState = new Map<
    string,
    { localRevision: number; lastSavedRevision: number }
  >();

  const syncStatus = (draft: StoredComposerDraft) => {
    revisionState.set(draft.draftId, {
      localRevision: draft.localRevision,
      lastSavedRevision: draft.lastSavedRevision
    });
  };

  return {
    async loadDraft(input) {
      const raw = await storage.load(input.storageKey);
      const draft = normalizeStoredDraft(raw);
      if (draft) {
        syncStatus(draft);
      }

      return { draft, raw };
    },
    async saveDraft(input) {
      const savedAt = new Date().toISOString();
      const storedDraft: StoredComposerDraft = {
        version: 2,
        ...input.draft,
        autosaveStatus: "saved",
        lastSavedRevision: input.draft.localRevision,
        updatedAt: savedAt,
        savedAt
      };

      await storage.save(input.storageKey, JSON.stringify(storedDraft));
      syncStatus(storedDraft);

      return {
        draft: storedDraft,
        requestId: input.requestId,
        savedRevision: storedDraft.lastSavedRevision,
        savedAt
      };
    },
    markLocalDirty({ draftId, localRevision }) {
      const current = revisionState.get(draftId) ?? {
        localRevision: 0,
        lastSavedRevision: 0
      };
      revisionState.set(draftId, {
        ...current,
        localRevision
      });
    },
    getDraftStatus(draftId) {
      const state = revisionState.get(draftId);
      if (!state) {
        return null;
      }

      return { draftId, ...state };
    },
    async recoverDraft(input) {
      return await this.loadDraft(input);
    },
    async clearDraft(storageKey) {
      await storage.remove(storageKey);
    }
  };
}
