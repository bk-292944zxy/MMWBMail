export type ComposeEventReminder =
  | "none"
  | "at_time"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "1d";

export type ComposeEventInvitee = {
  email: string;
  name?: string;
};

export type ComposeEventFormState = {
  title: string;
  invitees: ComposeEventInvitee[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isMultiDay: boolean;
  timezone: string;
  location: string;
  notes: string;
  reminder: ComposeEventReminder;
};

export type ComposeEvent = {
  title: string;
  invitees: ComposeEventInvitee[];
  start: Date;
  end?: Date;
  isAllDay: boolean;
  timezone: string;
  location?: string;
  notes?: string;
  reminder?: ComposeEventReminder;
};

export type GeneratedEventAsset = {
  eventId: string;
  fileName: string;
  mimeType: "text/calendar";
  icsText: string;
};

export type ComposeEventAttachmentState = {
  eventId: string;
  attachmentId: string;
  fileName: string;
};

export type ComposeEventValidationErrors = Partial<
  Record<
    | "title"
    | "startDate"
    | "startTime"
    | "endDate"
    | "endTime"
    | "timezone"
    | "invitees"
    | "location"
    | "notes",
    string
  >
>;
