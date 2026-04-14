import {
  normalizeStoredDraftCollection,
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
  clearDraft(storageKey: string, draftId?: string | null): Promise<void>;
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
      const collection = normalizeStoredDraftCollection(raw);
      const resolvedDraftId =
        input.draftId ?? collection.activeDraftId ?? null;
      const draft = resolvedDraftId ? collection.draftsById[resolvedDraftId] ?? null : null;
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

      const existingRaw = await storage.load(input.storageKey);
      const collection = normalizeStoredDraftCollection(existingRaw);
      const nextCollection = {
        version: 3 as const,
        activeDraftId: storedDraft.draftId,
        draftsById: {
          ...collection.draftsById,
          [storedDraft.draftId]: storedDraft
        },
        updatedAt: savedAt
      };

      await storage.save(input.storageKey, JSON.stringify(nextCollection));
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
    async clearDraft(storageKey, draftId) {
      if (!draftId) {
        await storage.remove(storageKey);
        revisionState.clear();
        return;
      }

      const raw = await storage.load(storageKey);
      const collection = normalizeStoredDraftCollection(raw);
      if (!collection.draftsById[draftId]) {
        return;
      }

      const { [draftId]: _removed, ...remainingDrafts } = collection.draftsById;
      const remainingDraftIds = Object.keys(remainingDrafts);
      if (remainingDraftIds.length === 0) {
        await storage.remove(storageKey);
        revisionState.delete(draftId);
        return;
      }

      const nextActiveDraftId =
        collection.activeDraftId === draftId
          ? remainingDraftIds[0] ?? null
          : collection.activeDraftId ?? remainingDraftIds[0] ?? null;

      await storage.save(
        storageKey,
        JSON.stringify({
          version: 3,
          activeDraftId: nextActiveDraftId,
          draftsById: remainingDrafts,
          updatedAt: new Date().toISOString()
        })
      );
      revisionState.delete(draftId);
    }
  };
}
