import type {
  ComposeEvent,
  GeneratedEventAsset
} from "@/composer/events/types";
import {
  getComposeEventFileBaseName,
  normalizeComposeEventReminder
} from "@/composer/events/state";

function escapeICSText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldICSLine(line: string) {
  if (line.length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < line.length) {
    const end = start === 0 ? start + 75 : start + 74;
    chunks.push(start === 0 ? line.slice(start, end) : ` ${line.slice(start, end)}`);
    start = end;
  }

  return chunks.join("\r\n");
}

function formatUtcStamp(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function formatDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;

  return {
    year: lookup.year ?? date.getUTCFullYear(),
    month: lookup.month ?? date.getUTCMonth() + 1,
    day: lookup.day ?? date.getUTCDate(),
    hour: lookup.hour ?? date.getUTCHours(),
    minute: lookup.minute ?? date.getUTCMinutes(),
    second: lookup.second ?? date.getUTCSeconds()
  };
}

function formatDateOnly(date: Date, timeZone: string) {
  const parts = formatDateParts(date, timeZone);
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function formatDateTime(date: Date, timeZone: string) {
  const parts = formatDateParts(date, timeZone);
  return `${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}${String(parts.second).padStart(2, "0")}`;
}

function escapeICSParam(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/:/g, "\\:");
}

function getReminderTrigger(reminder: ReturnType<typeof normalizeComposeEventReminder>) {
  switch (reminder) {
    case "at_time":
      return "TRIGGER:PT0M";
    case "5m":
      return "TRIGGER:-PT5M";
    case "15m":
      return "TRIGGER:-PT15M";
    case "30m":
      return "TRIGGER:-PT30M";
    case "1h":
      return "TRIGGER:-PT1H";
    case "1d":
      return "TRIGGER:-P1D";
    default:
      return null;
  }
}

export function generateICSFromComposeEvent(event: ComposeEvent): GeneratedEventAsset {
  const eventId = `compose-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const title = event.title.trim();
  const now = new Date();
  const summary = escapeICSText(title || "Untitled event");
  const location = event.location?.trim();
  const notes = event.notes?.trim();
  const reminder = normalizeComposeEventReminder(event.reminder);
  const attendees = (event.invitees ?? []).filter((invitee) => invitee.email.trim().length > 0);
  const dtStart = event.isAllDay
    ? `DTSTART;VALUE=DATE:${formatDateOnly(event.start, event.timezone)}`
    : `DTSTART;TZID=${event.timezone}:${formatDateTime(event.start, event.timezone)}`;
  const dtEnd =
    event.end instanceof Date
      ? event.isAllDay
        ? `DTEND;VALUE=DATE:${formatDateOnly(event.end, event.timezone)}`
        : `DTEND;TZID=${event.timezone}:${formatDateTime(event.end, event.timezone)}`
      : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MMWB Mail//Compose Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${eventId}@mmwbmail.local`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    dtStart,
    dtEnd,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${escapeICSText(location)}` : null,
    notes ? `DESCRIPTION:${escapeICSText(notes)}` : null,
    attendees.map((invitee) => {
      const email = invitee.email.trim();
      const displayName = invitee.name?.trim();
      const commonFields = [
        "ATTENDEE",
        "ROLE=REQ-PARTICIPANT",
        "PARTSTAT=NEEDS-ACTION",
        "RSVP=TRUE"
      ];
      if (displayName) {
        commonFields.push(`CN=${escapeICSParam(displayName)}`);
      }
      return `${commonFields.join(";")}:mailto:${email}`;
    }),
    reminder !== "none"
      ? [
          "BEGIN:VALARM",
          getReminderTrigger(reminder),
          "ACTION:DISPLAY",
          `DESCRIPTION:${summary}`,
          "END:VALARM"
        ].filter(Boolean)
      : null,
    "END:VEVENT",
    "END:VCALENDAR"
  ]
    .flat()
    .filter((line): line is string => Boolean(line))
    .map(foldICSLine)
    .join("\r\n");

  const fileName = `${getComposeEventFileBaseName(title)}.ics`;

  return {
    eventId,
    fileName,
    mimeType: "text/calendar",
    icsText: `${lines}\r\n`
  };
}
