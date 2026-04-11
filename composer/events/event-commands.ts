import type { ComposerCommand } from "@/composer/commands/types";

export function createEventCommands(): ComposerCommand[] {
  return [
    {
      id: "create_calendar_event",
      label: "Create calendar event",
      icon: "calendar",
      group: "attachments",
      run: (ctx) => {
        ctx.events?.openComposeEventBuilder();
      }
    }
  ];
}
