export type SortFolderPresetKey = "receipts" | "travel" | "follow_up" | "reference";

export type SortFolderPreset = {
  key: SortFolderPresetKey;
  label: string;
  folderName: string;
  tooltip: string;
  shortLabel: string;
  tone: "amber" | "sky" | "rose" | "slate";
  description: string;
};

export const SORT_FOLDER_PRESETS: SortFolderPreset[] = [
  {
    key: "receipts",
    label: "Receipts",
    folderName: "Receipts",
    tooltip: "Quick Sort · Receipts: proof of purchase, invoices, bills, confirmations, and charges.",
    shortLabel: "RC",
    tone: "amber",
    description: "Proof of purchase, invoices, bills, confirmations, and charges."
  },
  {
    key: "travel",
    label: "Travel",
    folderName: "Travel",
    tooltip: "Quick Sort · Travel: itineraries, booking confirmations, flights, hotels, and trip details.",
    shortLabel: "TR",
    tone: "sky",
    description: "Itineraries, booking confirmations, flights, hotels, and trip details."
  },
  {
    key: "follow_up",
    label: "Follow-Up",
    folderName: "Follow-Up",
    tooltip: "Quick Sort · Follow-Up: messages that still need attention or a later action.",
    shortLabel: "FU",
    tone: "rose",
    description: "Messages that still need attention or a later action."
  },
  {
    key: "reference",
    label: "Reference",
    folderName: "Reference",
    tooltip: "Quick Sort · Reference: useful information worth keeping, but not urgent right now.",
    shortLabel: "RF",
    tone: "slate",
    description: "Useful information worth keeping, but not urgent right now."
  }
];

function normalizeSortFolderValue(value: string) {
  return value.trim().toLowerCase();
}

export function getSortFolderPresetByMailbox(
  folderName?: string | null,
  folderPath?: string | null
): SortFolderPreset | null {
  const normalizedName = folderName ? normalizeSortFolderValue(folderName) : null;
  const normalizedPath = folderPath ? normalizeSortFolderValue(folderPath) : null;

  return (
    SORT_FOLDER_PRESETS.find((preset) => {
      const normalizedPreset = normalizeSortFolderValue(preset.folderName);
      return (
        normalizedName === normalizedPreset ||
        normalizedPath === normalizedPreset ||
        normalizedPath?.endsWith(`/${normalizedPreset}`) ||
        normalizedPath?.endsWith(`.${normalizedPreset}`)
      );
    }) ?? null
  );
}

export function getSortFolderTooltip(
  folderName?: string | null,
  folderPath?: string | null
): string | null {
  return getSortFolderPresetByMailbox(folderName, folderPath)?.tooltip ?? null;
}

export function getSortFolderPresentation(
  folderName?: string | null,
  folderPath?: string | null
): SortFolderPreset | null {
  return getSortFolderPresetByMailbox(folderName, folderPath);
}
