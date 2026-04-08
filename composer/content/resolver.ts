import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeIntent } from "@/composer/session/compose-intent";
import type {
  ComposeContentIntentKind,
  ComposeContentResolutionInput,
  ComposeContentState,
  ComposePresetDefinition,
  ComposeSignatureDefinition
} from "@/composer/content/types";

const ALL_INTENTS: ComposeContentIntentKind[] = [
  "new",
  "reply",
  "reply_all",
  "forward",
  "edit_as_new",
  "draft_resume"
];

export const DEFAULT_COMPOSE_PRESETS: ComposePresetDefinition[] = [
  {
    id: "insert_thanks",
    label: "Thanks note",
    category: "outro",
    appliesTo: ALL_INTENTS,
    text: "Thanks so much for the quick turnaround.\n\nBest,\n",
    html: "<p>Thanks so much for the quick turnaround.</p><p>Best,<br/></p>"
  },
  {
    id: "insert_follow_up",
    label: "Follow-up",
    category: "intro",
    appliesTo: ALL_INTENTS,
    text: "Following up on the note below when you have a moment.\n\nThank you,\n",
    html: "<p>Following up on the note below when you have a moment.</p><p>Thank you,<br/></p>"
  },
  {
    id: "insert_meeting_request",
    label: "Meeting ask",
    category: "snippet",
    appliesTo: ALL_INTENTS,
    text: "Would you be open to a quick 20-minute meeting next week?\n\nI can work around your schedule.\n",
    html: "<p>Would you be open to a quick 20-minute meeting next week?</p><p>I can work around your schedule.</p>"
  }
];

function uniqById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const next: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    next.push(item);
  }

  return next;
}

function intentSupportsSignature(
  signature: ComposeSignatureDefinition,
  intent: ComposeIntent
) {
  return signature.appliesTo.includes(intent.kind);
}

function signatureMatchesIdentity(
  signature: ComposeSignatureDefinition,
  identity: ComposeIdentityState | null
) {
  if (signature.signatureContextId) {
    return signature.signatureContextId === (identity?.signatureContextId ?? null);
  }

  if (signature.accountId) {
    return signature.accountId === identity?.accountId;
  }

  return true;
}

function signatureSortWeight(
  signature: ComposeSignatureDefinition,
  identity: ComposeIdentityState | null
) {
  if (signature.signatureContextId && signature.signatureContextId === identity?.signatureContextId) {
    return 0;
  }

  if (signature.accountId && signature.accountId === identity?.accountId) {
    return 1;
  }

  if (signature.isDefault) {
    return 2;
  }

  return 3;
}

export function getScopedSignatureDefinitionId(
  identity: ComposeIdentityState | null
) {
  if (identity?.signatureContextId) {
    return `signature:${identity.signatureContextId}`;
  }

  if (identity?.accountId) {
    return `signature:account:${identity.accountId}`;
  }

  return "signature:default";
}

export function buildScopedSignatureDefinition(input: {
  identity: ComposeIdentityState | null;
  fallbackSignature: string;
  existingId?: string | null;
}) {
  const label =
    input.identity?.sender?.label ||
    input.identity?.sender?.displayName ||
    input.identity?.sender?.address ||
    "Default signature";

  return {
    id: input.existingId ?? getScopedSignatureDefinitionId(input.identity),
    label,
    text: input.fallbackSignature,
    accountId: input.identity?.accountId,
    signatureContextId: input.identity?.signatureContextId ?? null,
    appliesTo: ALL_INTENTS,
    isDefault: !input.identity?.accountId
  } satisfies ComposeSignatureDefinition;
}

export function upsertSignatureDefinition(
  definitions: ComposeSignatureDefinition[],
  nextDefinition: ComposeSignatureDefinition
) {
  const matchIndex = definitions.findIndex(
    (definition) =>
      definition.id === nextDefinition.id ||
      (definition.accountId ?? null) === (nextDefinition.accountId ?? null) &&
        (definition.signatureContextId ?? null) ===
          (nextDefinition.signatureContextId ?? null)
  );

  if (matchIndex === -1) {
    return [...definitions, nextDefinition];
  }

  return definitions.map((definition, index) =>
    index === matchIndex ? nextDefinition : definition
  );
}

function resolveAvailableSignatures(
  identity: ComposeIdentityState | null,
  signatureDefinitions: ComposeSignatureDefinition[],
  fallbackSignature: string
) {
  const matching = signatureDefinitions
    .filter((definition) => signatureMatchesIdentity(definition, identity))
    .sort((left, right) => {
      const weightDiff =
        signatureSortWeight(left, identity) - signatureSortWeight(right, identity);

      if (weightDiff !== 0) {
        return weightDiff;
      }

      return left.label.localeCompare(right.label);
    });

  if (matching.length > 0) {
    return matching;
  }

  return [
    buildScopedSignatureDefinition({
      identity,
      fallbackSignature
    })
  ];
}

function resolvePresets(
  presetDefinitions: ComposePresetDefinition[],
  intent: ComposeIntent
) {
  return uniqById([...DEFAULT_COMPOSE_PRESETS, ...presetDefinitions]).filter((preset) =>
    preset.appliesTo.includes(intent.kind)
  );
}

export function resolveComposeContentState(
  input: ComposeContentResolutionInput
): ComposeContentState {
  const availableSignatures = resolveAvailableSignatures(
    input.identity,
    input.signatureDefinitions,
    input.fallbackSignature
  );
  const persistedActiveId = input.persistedState?.activeSignatureId ?? null;
  const persistedIdentityId = input.persistedState?.identitySignatureId ?? null;
  const identitySignature =
    availableSignatures.find(
      (definition) => definition.id === persistedIdentityId
    ) ?? availableSignatures[0] ?? null;
  const activeSignature =
    availableSignatures.find((definition) => definition.id === persistedActiveId) ??
    identitySignature;
  const activeSignatureText =
    input.persistedState?.activeSignatureId === activeSignature?.id &&
    typeof input.persistedState?.activeSignatureText === "string"
      ? input.persistedState.activeSignatureText
      : activeSignature?.text ?? "";

  return {
    identitySignatureId: identitySignature?.id ?? null,
    activeSignatureId: activeSignature?.id ?? null,
    activeSignatureLabel: activeSignature?.label ?? "No signature",
    activeSignatureText,
    availableSignatures,
    presets: resolvePresets(input.presetDefinitions, input.intent),
    insertedBlocks: input.persistedState?.insertedBlocks ?? [],
    defaultSignatureInserted:
      input.persistedState?.defaultSignatureInserted ??
      Boolean(activeSignature && activeSignatureText.trim() && intentSupportsSignature(activeSignature, input.intent))
  };
}
