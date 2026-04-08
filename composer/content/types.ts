import type { ComposeIdentityState } from "@/composer/identity/types";
import type { ComposeIntent } from "@/composer/session/compose-intent";

export type ComposeContentIntentKind = ComposeIntent["kind"];

export type ComposeSignatureDefinition = {
  id: string;
  label: string;
  text: string;
  accountId?: string;
  signatureContextId?: string | null;
  appliesTo: ComposeContentIntentKind[];
  isDefault?: boolean;
};

export type ComposePresetDefinition = {
  id: string;
  label: string;
  text: string;
  html?: string;
  category: "intro" | "outro" | "snippet";
  appliesTo: ComposeContentIntentKind[];
};

export type ComposeInsertedContentBlock = {
  id: string;
  kind: "signature" | "preset";
  sourceId: string;
  label: string;
};

export type ComposeContentState = {
  identitySignatureId: string | null;
  activeSignatureId: string | null;
  activeSignatureLabel: string;
  activeSignatureText: string;
  availableSignatures: ComposeSignatureDefinition[];
  presets: ComposePresetDefinition[];
  insertedBlocks: ComposeInsertedContentBlock[];
  defaultSignatureInserted: boolean;
};

export type ComposeContentResolutionInput = {
  identity: ComposeIdentityState | null;
  intent: ComposeIntent;
  signatureDefinitions: ComposeSignatureDefinition[];
  presetDefinitions: ComposePresetDefinition[];
  fallbackSignature: string;
  persistedState?: Partial<ComposeContentState> | null;
};
