import type { SelectionState } from "@/composer/context/types";

export interface ExistingEditorAdapter {
  focus(): void;
  hasEditableTarget(): boolean;
  isPlainText(): boolean;
  exec(command: string, value?: string): boolean;
  setFontFamily(value: string): boolean;
  setFontSize(value: string): boolean;
  transformCase(mode: "upper" | "lower" | "title"): void;
  togglePlainText(): void;
  openLinkDialog(): void;
  openAttachPicker(): void;
  openImagePicker(): void;
  insertSignature(): void;
  insertText(text: string): void;
  insertHtml?(html: string): void;
  getHtml(): string;
  getText(): string;
  getSelection(): SelectionState;
  saveDraft(): void;
  openPrintDialog(): void;
  clearFormatting(): boolean;
}

type ExistingEditorAdapterOptions = {
  focus: () => void;
  hasEditableTarget: () => boolean;
  isPlainText: () => boolean;
  exec: (command: string, value?: string) => boolean;
  transformCase: (mode: "upper" | "lower" | "title") => void;
  togglePlainText: () => void;
  openLinkDialog: () => void;
  openAttachPicker: () => void;
  openImagePicker: () => void;
  insertSignature: () => void;
  insertText: (text: string) => void;
  insertHtml?: (html: string) => void;
  getHtml: () => string;
  getText: () => string;
  getSelection: () => SelectionState;
  saveDraft: () => void;
  openPrintDialog: () => void;
  clearFormatting?: () => boolean;
};

const FONT_SIZE_MAP: Record<string, string> = {
  "10": "1",
  "11": "1",
  "12": "2",
  "13": "2",
  "14": "3",
  "16": "3",
  "18": "4",
  "20": "4",
  "24": "5",
  "28": "5",
  "32": "6",
  "36": "6",
  "48": "7"
};

export function createExistingEditorAdapter(
  options: ExistingEditorAdapterOptions
): ExistingEditorAdapter {
  return {
    focus: options.focus,
    hasEditableTarget: options.hasEditableTarget,
    isPlainText: options.isPlainText,
    exec: options.exec,
    setFontFamily(value) {
      return options.exec("fontName", value);
    },
    setFontSize(value) {
      const execValue = FONT_SIZE_MAP[value] ?? "3";
      return options.exec("fontSize", execValue);
    },
    transformCase: options.transformCase,
    togglePlainText: options.togglePlainText,
    openLinkDialog: options.openLinkDialog,
    openAttachPicker: options.openAttachPicker,
    openImagePicker: options.openImagePicker,
    insertSignature: options.insertSignature,
    insertText: options.insertText,
    insertHtml: options.insertHtml,
    getHtml: options.getHtml,
    getText: options.getText,
    getSelection: options.getSelection,
    saveDraft: options.saveDraft,
    openPrintDialog: options.openPrintDialog,
    clearFormatting() {
      if (options.clearFormatting) {
        return options.clearFormatting();
      }

      return options.exec("removeFormat");
    }
  };
}
