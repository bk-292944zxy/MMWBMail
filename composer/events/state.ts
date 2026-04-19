import type {
  ComposeEvent,
  ComposeEventFormState,
  ComposeEventReminder,
  ComposeEventValidationErrors
} from "@/composer/events/types";

const DEFAULT_TIME_ZONE = getDefaultTimeZone();

function getDefaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
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

function formatDateInputValue(date: Date, timeZone: string) {
  const parts = formatDateParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function formatTimeInputValue(date: Date, timeZone: string) {
  const parts = formatDateParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeValue(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function roundUpToSlot(date: Date, slotMinutes = 30) {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  const remainder = minutes % slotMinutes;

  if (remainder === 0) {
    return next;
  }

  next.setMinutes(minutes + slotMinutes - remainder);
  return next;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function parseTimeParts(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = formatDateParts(date, timeZone);
  const utcMillis = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return (utcMillis - date.getTime()) / 60000;
}

function parseDateTimeInTimeZone(dateValue: string, timeValue: string, timeZone: string) {
  const dateParts = parseDateParts(dateValue);
  const timeParts = parseTimeParts(timeValue);

  if (!dateParts || !timeParts) {
    return null;
  }

  let utcMillis = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0,
    0
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = getTimeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const nextUtcMillis =
      Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour,
        timeParts.minute,
        0,
        0
      ) -
      offset * 60 * 1000;

    if (nextUtcMillis === utcMillis) {
      break;
    }

    utcMillis = nextUtcMillis;
  }

  return new Date(utcMillis);
}

function sanitizeFileName(input: string) {
  const cleaned = input
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\-+|\-+$/g, "");

  return cleaned || "invite";
}

function normalizeComposeEventInvitees(invitees: ComposeEventFormState["invitees"]) {
  const map = new Map<string, { email: string; name?: string }>();
  for (const invitee of invitees) {
    const email = invitee.email.trim().toLowerCase();
    if (!email) {
      continue;
    }
    const name = invitee.name?.trim();
    map.set(email, name ? { email, name } : { email });
  }
  return Array.from(map.values());
}

function toTitleCaseFallback(value: string) {
  return value
    .split(/[-_]+|\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function getDefaultComposeEventTimeZone() {
  return DEFAULT_TIME_ZONE;
}

export function createDefaultComposeEventFormState(
  referenceDate = new Date()
): ComposeEventFormState {
  const timezone = getDefaultComposeEventTimeZone();
  const start = roundUpToSlot(referenceDate, 30);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: "",
    invitees: [],
    startDate: formatDateInputValue(start, timezone),
    startTime: formatTimeInputValue(start, timezone),
    endDate: formatDateInputValue(end, timezone),
    endTime: formatTimeInputValue(end, timezone),
    isMultiDay: false,
    timezone,
    location: "",
    notes: "",
    reminder: "15m"
  };
}

export function buildComposeEventFromForm(
  form: ComposeEventFormState
): ComposeEvent | null {
  const timezone = isValidTimeZone(form.timezone) ? form.timezone : getDefaultComposeEventTimeZone();
  const title = form.title.trim();

  if (!isValidDateValue(form.startDate)) {
    return null;
  }

  const start = parseDateTimeInTimeZone(form.startDate, form.startTime, timezone);

  if (!start) {
    return null;
  }

  const end =
    isValidDateValue(form.endDate) && isValidTimeValue(form.endTime)
      ? parseDateTimeInTimeZone(form.endDate, form.endTime, timezone) ?? undefined
      : undefined;

  let normalizedEnd = end;

  if (!normalizedEnd || normalizedEnd.getTime() <= start.getTime()) {
    normalizedEnd = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return {
    title,
    invitees: normalizeComposeEventInvitees(form.invitees),
    start,
    end: normalizedEnd,
    isAllDay: false,
    timezone,
    location: form.location.trim() || undefined,
    notes: form.notes.trim() || undefined,
    reminder: form.reminder === "none" ? undefined : form.reminder
  };
}

export function validateComposeEventForm(
  form: ComposeEventFormState
): ComposeEventValidationErrors {
  const errors: ComposeEventValidationErrors = {};

  if (!form.title.trim()) {
    errors.title = "Add an event name.";
  }

  if (!isValidDateValue(form.startDate)) {
    errors.startDate = "Choose a start date.";
  }

  if (!isValidTimeValue(form.startTime)) {
    errors.startTime = "Choose a start time.";
  }

  if (!isValidDateValue(form.endDate)) {
    errors.endDate = "Choose an end date.";
  }

  if (!isValidTimeValue(form.endTime)) {
    errors.endTime = "Choose an end time.";
  }

  if (form.timezone.trim() && !isValidTimeZone(form.timezone.trim())) {
    errors.timezone = "Use a valid IANA time zone.";
  }

  return errors;
}

export function normalizeComposeEventReminder(
  reminder: ComposeEventReminder | string | null | undefined
): ComposeEventReminder {
  switch (reminder) {
    case "at_time":
    case "5m":
    case "15m":
    case "30m":
    case "1h":
    case "1d":
      return reminder;
    default:
      return "none";
  }
}

export function createComposeEventSummaryFromForm(form: ComposeEventFormState) {
  const event = buildComposeEventFromForm(form);
  if (!event) {
    return null;
  }

  return event;
}

export function createComposeEventFormFromEvent(event: ComposeEvent): ComposeEventFormState {
  const timezone = isValidTimeZone(event.timezone) ? event.timezone : getDefaultComposeEventTimeZone();
  const end = event.end ?? new Date(event.start.getTime() + 60 * 60 * 1000);

  return {
    title: event.title,
    invitees: event.invitees ?? [],
    startDate: formatDateInputValue(event.start, timezone),
    startTime: formatTimeInputValue(event.start, timezone),
    endDate: formatDateInputValue(end, timezone),
    endTime: formatTimeInputValue(end, timezone),
    isMultiDay:
      Boolean(event.end) &&
      formatDateInputValue(event.start, timezone) !== formatDateInputValue(end, timezone),
    timezone,
    location: event.location ?? "",
    notes: event.notes ?? "",
    reminder: normalizeComposeEventReminder(event.reminder)
  };
}

export function formatComposeEventDateTimeLabel(date: Date, timeZone: string) {
  const dateParts = formatDateParts(date, timeZone);
  return `${dateParts.year}-${pad(dateParts.month)}-${pad(dateParts.day)} ${pad(
    dateParts.hour
  )}:${pad(dateParts.minute)}`;
}

export function getComposeEventFileBaseName(title: string) {
  const fallback = toTitleCaseFallback(sanitizeFileName(title));
  return fallback ? sanitizeFileName(fallback) : "invite";
}
