import type {
  MailAccountProviderInfo,
  MailConnectionPayload,
  MailProviderKind,
  ProviderCapabilities
} from "@/lib/mail-types";
import {
  getMailProviderProfile,
  getMailProviderProfileByIdentity,
  resolveMailProviderKind
} from "@/lib/mail-provider-profiles";

type ProviderIdentityInput = Pick<
  MailConnectionPayload,
  "email" | "imapHost" | "smtpHost"
> & {
  provider?: string | null;
};

export function inferMailProviderKind(input: ProviderIdentityInput): MailProviderKind {
  return resolveMailProviderKind(input);
}

export function getProviderCapabilities(kind: MailProviderKind): ProviderCapabilities {
  return getMailProviderProfile(kind).capabilities;
}

export function getMailAccountProviderInfo(
  input: ProviderIdentityInput
): MailAccountProviderInfo {
  const profile = getMailProviderProfileByIdentity(input);

  return {
    kind: profile.kind,
    label: profile.label,
    capabilities: profile.capabilities
  };
}
