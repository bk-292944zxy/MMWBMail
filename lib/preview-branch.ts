function normalizeBranchName(value: string | undefined) {
  return (value ?? "").trim();
}

export function getPreviewBranchName() {
  const normalized = normalizeBranchName(process.env.NEXT_PUBLIC_GIT_BRANCH);
  return normalized || null;
}

export function shouldShowPreviewBranchBadge() {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  const branchName = getPreviewBranchName();
  return Boolean(branchName);
}
