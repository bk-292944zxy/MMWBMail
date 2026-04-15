import type {
  ElectronDeleteDraftInput,
  ElectronListDraftsInput,
  ElectronLoadDraftInput,
  ElectronMailBridge,
  ElectronSaveDraftInput
} from "@/lib/electron/ipc-contract";
import type { LoadDraftResult, SaveDraftResult, StoredComposerDraft } from "@/composer/drafts/draft-types";

function getDesktopBridge(): ElectronMailBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.maximailDesktop;
  if (!bridge || bridge.isElectron !== true || bridge.version !== 2) {
    return null;
  }

  if (
    typeof bridge.createDraft !== "function" ||
    typeof bridge.saveDraft !== "function" ||
    typeof bridge.loadDraft !== "function" ||
    typeof bridge.listDrafts !== "function" ||
    typeof bridge.deleteDraft !== "function"
  ) {
    return null;
  }

  return bridge;
}

function normalizeIpcError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return new Error(error.message);
  }

  return new Error(fallback);
}

function logDraftClient(prefix: string, payload: Record<string, unknown>) {
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

export function isElectronDraftIpcAvailable() {
  return Boolean(getDesktopBridge());
}

export async function createDraftIpcClient(input: ElectronSaveDraftInput): Promise<SaveDraftResult> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron draft bridge unavailable.");
  }

  try {
    logDraftClient("[DRAFT_SAVE]", {
      stage: "renderer-bridge-create-draft",
      draftId: input.draft.draftId,
      accountId: input.draft.accountId ?? null,
      textBody: input.draft.textBody ?? null,
      htmlBody: input.draft.htmlBody ?? null,
      composeBodyAtSave: input.draft.textBody ?? null
    });
    return await bridge.createDraft(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to create draft.");
  }
}

export async function saveDraftIpcClient(input: ElectronSaveDraftInput): Promise<SaveDraftResult> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron draft bridge unavailable.");
  }

  try {
    logDraftClient("[DRAFT_SAVE]", {
      stage: "renderer-bridge-save-draft",
      draftId: input.draft.draftId,
      accountId: input.draft.accountId ?? null,
      textBody: input.draft.textBody ?? null,
      htmlBody: input.draft.htmlBody ?? null,
      composeBodyAtSave: input.draft.textBody ?? null
    });
    return await bridge.saveDraft(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to save draft.");
  }
}

export async function loadDraftIpcClient(input: ElectronLoadDraftInput): Promise<LoadDraftResult> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron draft bridge unavailable.");
  }

  try {
    const result = await bridge.loadDraft(input);
    logDraftClient("[DRAFT_LOAD]", {
      stage: "renderer-bridge-load-draft",
      draftId: result.draft?.draftId ?? null,
      restoredTextBody: result.draft?.textBody ?? null,
      restoredHtmlBody: result.draft?.htmlBody ?? null
    });
    return result;
  } catch (error) {
    throw normalizeIpcError(error, "Unable to load draft.");
  }
}

export async function listDraftsIpcClient(
  input: ElectronListDraftsInput = {}
): Promise<{ drafts: StoredComposerDraft[] }> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron draft bridge unavailable.");
  }

  try {
    return await bridge.listDrafts(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to list drafts.");
  }
}

export async function deleteDraftIpcClient(
  input: ElectronDeleteDraftInput
): Promise<{ deleted: boolean }> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error("Electron draft bridge unavailable.");
  }

  try {
    return await bridge.deleteDraft(input);
  } catch (error) {
    throw normalizeIpcError(error, "Unable to delete draft.");
  }
}
