import type {
  DraftStatusState,
  SaveDraftResult
} from "@/composer/drafts/draft-types";

export function isStaleDraftResponse(
  response: SaveDraftResult,
  state: DraftStatusState
) {
  if (state.inFlightRequestId !== null && response.requestId < state.inFlightRequestId) {
    return true;
  }

  return response.savedRevision < state.localRevision;
}

export function createInitialDraftStatusState(): DraftStatusState {
  return {
    status: "idle",
    lastSavedRevision: 0,
    localRevision: 0,
    inFlightRequestId: null,
    error: null,
    savedAt: null
  };
}
