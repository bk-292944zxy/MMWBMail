import {
  createInitialDraftStatusState,
  isStaleDraftResponse
} from "@/composer/drafts/draft-conflict";
import type {
  DraftStatusState,
  SaveDraftInput,
  SaveDraftResult
} from "@/composer/drafts/draft-types";

type AutosaveOptions = {
  debounceMs?: number;
  onStatusChange?: (state: DraftStatusState) => void;
  saveDraft: (input: SaveDraftInput) => Promise<SaveDraftResult>;
};

export interface AutosaveService {
  getState(): DraftStatusState;
  schedule(input: Omit<SaveDraftInput, "requestId">): void;
  flush(input: Omit<SaveDraftInput, "requestId">): Promise<void>;
  cancel(): void;
}

export function createAutosaveService(options: AutosaveOptions): AutosaveService {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextRequestId = 0;
  let queuedInput: Omit<SaveDraftInput, "requestId"> | null = null;
  let state = createInitialDraftStatusState();

  const updateState = (next: DraftStatusState) => {
    state = next;
    options.onStatusChange?.(state);
  };

  const runSave = async (input: Omit<SaveDraftInput, "requestId">) => {
    const requestId = ++nextRequestId;
    updateState({
      ...state,
      status: "saving",
      inFlightRequestId: requestId,
      localRevision: input.draft.localRevision,
      error: null
    });

    try {
      const result = await options.saveDraft({
        ...input,
        requestId
      });

      if (isStaleDraftResponse(result, state)) {
        return;
      }

      updateState({
        ...state,
        status:
          result.savedRevision < state.localRevision ? "unsaved" : "saved",
        lastSavedRevision: result.savedRevision,
        savedAt: result.savedAt,
        inFlightRequestId: null,
        error: null
      });

      if (queuedInput && queuedInput.draft.localRevision > result.savedRevision) {
        const pending = queuedInput;
        queuedInput = null;
        await runSave(pending);
      }
    } catch (error) {
      updateState({
        ...state,
        status: "failed",
        inFlightRequestId: null,
        error: error instanceof Error ? error.message : "Autosave failed"
      });
    }
  };

  const schedule = (input: Omit<SaveDraftInput, "requestId">) => {
    queuedInput = input;
    updateState({
      ...state,
      status: "unsaved",
      localRevision: input.draft.localRevision,
      error: null
    });

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      const pending = queuedInput;
      queuedInput = null;
      if (pending) {
        void runSave(pending);
      }
    }, options.debounceMs ?? 1200);
  };

  const flush = async (input: Omit<SaveDraftInput, "requestId">) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    queuedInput = null;
    await runSave(input);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    queuedInput = null;
  };

  return {
    getState: () => state,
    schedule,
    flush,
    cancel
  };
}
