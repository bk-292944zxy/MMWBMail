import type { ComposerCommandContext } from "@/composer/context/types";

export type ComposerCommandId =
  | "toggle_plain_text"
  | "font_family"
  | "font_size"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "uppercase_selection"
  | "lowercase_selection"
  | "capitalize_selection"
  | "align_left"
  | "align_center"
  | "link"
  | "quote"
  | "bullet_list"
  | "number_list"
  | "indent"
  | "outdent"
  | "clear_formatting"
  | "rewrite_for_outcome"
  | "attach_file"
  | "insert_image"
  | "insert_signature"
  | "insert_thanks"
  | "insert_follow_up"
  | "insert_meeting_request"
  | "save_draft"
  | "schedule_send"
  | "print_message";

export type ComposerCommandGroup =
  | "mode"
  | "format"
  | "insert"
  | "review"
  | "message"
  | "attachments";

export type ComposerCommandControl = "button" | "select";

export interface ComposerCommandOption {
  value: string;
  label: string;
}

export interface ComposerCommand {
  id: ComposerCommandId;
  label: string;
  icon?: string;
  group: ComposerCommandGroup;
  control?: ComposerCommandControl;
  options?: ComposerCommandOption[];
  placeholder?: string;
  isVisible?: (ctx: ComposerCommandContext) => boolean;
  isEnabled?: (ctx: ComposerCommandContext) => boolean;
  isActive?: (ctx: ComposerCommandContext) => boolean;
  run: (ctx: ComposerCommandContext) => Promise<void> | void;
  runWithValue?: (
    ctx: ComposerCommandContext,
    value: string
  ) => Promise<void> | void;
  shortcut?: string;
}
