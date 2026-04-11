import { createAttachmentCommands } from "@/composer/attachments/attachment-commands";
import type { ComposerCommand } from "@/composer/commands/types";
import { createEventCommands } from "@/composer/events/event-commands";

function insertSnippet(
  ctx: Parameters<NonNullable<ComposerCommand["run"]>>[0],
  plainText: string,
  richHtml?: string
) {
  if (!ctx.composeState.plainText && richHtml && ctx.editor.insertHtml) {
    ctx.editor.insertHtml(richHtml);
    return;
  }

  ctx.editor.insertText(plainText);
}

export const COMPOSER_COMMANDS: ComposerCommand[] = [
  {
    id: "toggle_plain_text",
    label: "Plain text",
    icon: "plain_text",
    group: "mode",
    isActive: (ctx) => ctx.composeState.plainText,
    run: (ctx) => ctx.editor.togglePlainText()
  },
  {
    id: "font_family",
    label: "Font",
    group: "format",
    control: "select",
    placeholder: "Font",
    options: [
      { value: "Inter, sans-serif", label: "Inter" },
      { value: "-apple-system, sans-serif", label: "System" },
      { value: "Georgia, serif", label: "Georgia" },
      { value: "Times New Roman, serif", label: "Times New Roman" },
      { value: "Courier New, monospace", label: "Courier New" },
      { value: "Arial, sans-serif", label: "Arial" },
      { value: "Verdana, sans-serif", label: "Verdana" },
      { value: "Trebuchet MS, sans-serif", label: "Trebuchet" }
    ],
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: () => undefined,
    runWithValue: (ctx, value) => {
      ctx.editor.setFontFamily(value);
    }
  },
  {
    id: "font_size",
    label: "Size",
    group: "format",
    control: "select",
    placeholder: "Size",
    options: [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => ({
      value: String(size),
      label: String(size)
    })),
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: () => undefined,
    runWithValue: (ctx, value) => {
      ctx.editor.setFontSize(value);
    }
  },
  {
    id: "bold",
    label: "Bold",
    icon: "bold",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("bold");
    },
    shortcut: "Meta+B"
  },
  {
    id: "italic",
    label: "Italic",
    icon: "italic",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("italic");
    },
    shortcut: "Meta+I"
  },
  {
    id: "underline",
    label: "Underline",
    icon: "underline",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("underline");
    },
    shortcut: "Meta+U"
  },
  {
    id: "strikethrough",
    label: "Strikethrough",
    icon: "strikethrough",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("strikeThrough");
    }
  },
  {
    id: "uppercase_selection",
    label: "Uppercase",
    icon: "uppercase",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget() && !ctx.selectionState.isCollapsed,
    run: (ctx) => {
      ctx.editor.transformCase("upper");
    }
  },
  {
    id: "lowercase_selection",
    label: "Lowercase",
    icon: "lowercase",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget() && !ctx.selectionState.isCollapsed,
    run: (ctx) => {
      ctx.editor.transformCase("lower");
    }
  },
  {
    id: "capitalize_selection",
    label: "Capitalize",
    icon: "capitalize",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget() && !ctx.selectionState.isCollapsed,
    run: (ctx) => {
      ctx.editor.transformCase("title");
    }
  },
  {
    id: "align_left",
    label: "Align left",
    icon: "align_left",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("justifyLeft");
    }
  },
  {
    id: "align_center",
    label: "Align center",
    icon: "align_center",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("justifyCenter");
    }
  },
  {
    id: "link",
    label: "Insert link",
    icon: "link",
    group: "insert",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => ctx.editor.openLinkDialog(),
    shortcut: "Meta+K"
  },
  {
    id: "quote",
    label: "Quote",
    icon: "quote",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("formatBlock", "blockquote");
    }
  },
  {
    id: "bullet_list",
    label: "Bullet list",
    icon: "bullet_list",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("insertUnorderedList");
    }
  },
  {
    id: "number_list",
    label: "Number list",
    icon: "number_list",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("insertOrderedList");
    }
  },
  {
    id: "indent",
    label: "Indent more",
    icon: "indent",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("indent");
    }
  },
  {
    id: "outdent",
    label: "Indent less",
    icon: "outdent",
    group: "format",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.exec("outdent");
    }
  },
  {
    id: "clear_formatting",
    label: "Clear formatting",
    icon: "clear_formatting",
    group: "review",
    isVisible: (ctx) => !ctx.composeState.plainText,
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.editor.clearFormatting();
    }
  },
  {
    id: "rewrite_for_outcome",
    label: "Elevate",
    icon: "rewrite",
    group: "review",
    isEnabled: (ctx) => ctx.editor.hasEditableTarget(),
    run: (ctx) => {
      ctx.ai?.openRewriteAssistant();
    }
  },
  ...createAttachmentCommands(),
  ...createEventCommands(),
  {
    id: "insert_signature",
    label: "Signature",
    icon: "signature",
    group: "insert",
    run: (ctx) => ctx.content?.insertSignature() ?? ctx.editor.insertSignature()
  },
  {
    id: "insert_thanks",
    label: "Thanks note",
    group: "insert",
    run: (ctx) => {
      if (ctx.content) {
        ctx.content.insertPresetById("insert_thanks");
        return;
      }

      insertSnippet(
        ctx,
        "Thanks so much for the quick turnaround.\n\nBest,\n",
        "<p>Thanks so much for the quick turnaround.</p><p>Best,<br/></p>"
      );
    }
  },
  {
    id: "insert_follow_up",
    label: "Follow-up",
    group: "insert",
    run: (ctx) => {
      if (ctx.content) {
        ctx.content.insertPresetById("insert_follow_up");
        return;
      }

      insertSnippet(
        ctx,
        "Following up on the note below when you have a moment.\n\nThank you,\n",
        "<p>Following up on the note below when you have a moment.</p><p>Thank you,<br/></p>"
      );
    }
  },
  {
    id: "insert_meeting_request",
    label: "Meeting ask",
    group: "insert",
    run: (ctx) => {
      if (ctx.content) {
        ctx.content.insertPresetById("insert_meeting_request");
        return;
      }

      insertSnippet(
        ctx,
        "Would you be open to a quick 20-minute meeting next week?\n\nI can work around your schedule.\n",
        "<p>Would you be open to a quick 20-minute meeting next week?</p><p>I can work around your schedule.</p>"
      );
    }
  },
  {
    id: "save_draft",
    label: "Save draft",
    icon: "save",
    group: "message",
    run: (ctx) => ctx.editor.saveDraft(),
    shortcut: "Meta+S"
  },
  {
    id: "schedule_send",
    label: "Schedule send",
    icon: "schedule",
    group: "message",
    isVisible: (ctx) => ctx.capabilityFlags.canScheduleSend,
    isEnabled: (ctx) => ctx.capabilityFlags.canScheduleSend,
    run: () => undefined,
    shortcut: "Meta+Shift+S"
  },
  {
    id: "print_message",
    label: "Print",
    icon: "print",
    group: "message",
    isVisible: (ctx) => ctx.capabilityFlags.canPrintDraft,
    isEnabled: (ctx) => ctx.capabilityFlags.canPrintDraft,
    run: (ctx) => ctx.editor.openPrintDialog(),
    shortcut: "Meta+Shift+P"
  }
];
