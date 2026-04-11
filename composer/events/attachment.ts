import { getComposeEventFileBaseName } from "@/composer/events/state";
import type {
  ComposeEventAttachmentState,
  ComposeEventFormState
} from "@/composer/events/types";

type AttachmentLookupRecord = {
  attachmentId?: string;
  name: string;
  type: string;
};

function isCalendarAttachment(record: AttachmentLookupRecord) {
  return record.type.startsWith("text/calendar");
}

function toAttachmentState(record: AttachmentLookupRecord, eventId: string) {
  if (!record.attachmentId) {
    return null;
  }

  return {
    eventId,
    attachmentId: record.attachmentId,
    fileName: record.name
  } satisfies ComposeEventAttachmentState;
}

export function resolveComposeEventAttachmentFromDraft(input: {
  attachments: AttachmentLookupRecord[];
  composeEvent: ComposeEventFormState | null;
  composeEventAttachment: ComposeEventAttachmentState | null;
}): ComposeEventAttachmentState | null {
  const calendarAttachments = input.attachments.filter(isCalendarAttachment);
  if (calendarAttachments.length === 0) {
    return null;
  }

  const existing = input.composeEventAttachment;
  if (existing) {
    const byAttachmentId = calendarAttachments.find(
      (attachment) => attachment.attachmentId === existing.attachmentId
    );
    if (byAttachmentId) {
      return {
        ...existing,
        fileName: byAttachmentId.name
      };
    }

    const byFileName = calendarAttachments.find((attachment) => attachment.name === existing.fileName);
    if (byFileName) {
      const fallback = toAttachmentState(byFileName, existing.eventId);
      if (fallback) {
        return fallback;
      }
    }
  }

  const inferredEventId = existing?.eventId ?? `compose-event-${Date.now()}`;
  const composeEvent = input.composeEvent;
  const expectedFileName = composeEvent
    ? `${getComposeEventFileBaseName(composeEvent.title)}.ics`
    : null;

  if (expectedFileName) {
    const matchingByExpectedName = calendarAttachments.filter(
      (attachment) => attachment.name === expectedFileName
    );
    if (matchingByExpectedName.length === 1) {
      const candidate = toAttachmentState(matchingByExpectedName[0], inferredEventId);
      if (candidate) {
        return candidate;
      }
    }
  }

  const matchingByPrefix = calendarAttachments.find(
    (attachment) => attachment.attachmentId?.startsWith("compose-event-")
  );
  if (matchingByPrefix) {
    const candidate = toAttachmentState(matchingByPrefix, inferredEventId);
    if (candidate) {
      return candidate;
    }
  }

  if (calendarAttachments.length === 1) {
    const candidate = toAttachmentState(calendarAttachments[0], inferredEventId);
    if (candidate) {
      return candidate;
    }
  }

  return existing;
}

export function upsertComposeEventAttachment(
  attachments: File[],
  nextAttachment: File,
  replaceIndex: number | null
) {
  if (replaceIndex === null || replaceIndex < 0 || replaceIndex >= attachments.length) {
    return [...attachments, nextAttachment];
  }

  const next = [...attachments];
  next[replaceIndex] = nextAttachment;
  return next;
}

export function findComposeEventAttachmentIndex(
  attachments: File[],
  attachmentState: ComposeEventAttachmentState | null,
  attachmentIds: WeakMap<File, string>
) {
  if (!attachmentState) {
    return -1;
  }

  return attachments.findIndex((file) => {
    const fileAttachmentId = attachmentIds.get(file);
    if (fileAttachmentId && fileAttachmentId === attachmentState.attachmentId) {
      return true;
    }

    if (fileAttachmentId) {
      return false;
    }

    return file.name === attachmentState.fileName && file.type.startsWith("text/calendar");
  });
}
