export type ComposeIntent =
  | { kind: "new" }
  | { kind: "reply"; sourceUid: number; sourceMessageId?: string | null }
  | { kind: "reply_all"; sourceUid: number; sourceMessageId?: string | null }
  | { kind: "forward"; sourceUid: number; sourceMessageId?: string | null }
  | { kind: "edit_as_new"; sourceUid: number; sourceMessageId?: string | null }
  | { kind: "draft_resume"; sourceDraftId: string };

export type MessageComposeIntentKind = Extract<
  ComposeIntent["kind"],
  "reply" | "reply_all" | "forward" | "edit_as_new"
>;

export function createNewComposeIntent(): ComposeIntent {
  return { kind: "new" };
}

export function createMessageComposeIntent(
  kind: MessageComposeIntentKind,
  sourceUid: number,
  sourceMessageId?: string | null
): ComposeIntent {
  return { kind, sourceUid, sourceMessageId: sourceMessageId ?? null };
}

export function createDraftResumeIntent(sourceDraftId: string): ComposeIntent {
  return { kind: "draft_resume", sourceDraftId };
}
