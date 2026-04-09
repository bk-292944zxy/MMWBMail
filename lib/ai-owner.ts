export type CurrentAiOwner = {
  scope: string;
  type: "single_owner_placeholder";
  label: string;
};

export function resolveCurrentAiOwner(): CurrentAiOwner {
  return {
    scope: "local-owner",
    type: "single_owner_placeholder",
    label: "Current owner"
  };
}
