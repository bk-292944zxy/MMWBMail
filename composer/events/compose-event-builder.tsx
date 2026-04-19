"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { generateICSFromComposeEvent } from "@/composer/events/ics";
import { getDefaultComposeEventTimeZone } from "@/composer/events/state";
import { useComposeEventBuilderState } from "@/composer/events/use-compose-event-builder-state";
import type {
  ComposeEvent,
  ComposeEventInvitee,
  ComposeEventFormState,
  GeneratedEventAsset
} from "@/composer/events/types";

type ComposeEventBuilderProps = {
  open: boolean;
  initialEvent: ComposeEventFormState | null;
  inviteeSuggestions?: string[];
  onClose: () => void;
  onCreate: (input: {
    event: ComposeEvent;
    form: ComposeEventFormState;
    asset: GeneratedEventAsset;
  }) => Promise<void> | void;
};

const TIMEZONE_SUGGESTIONS = Array.from(
  new Set([
    getDefaultComposeEventTimeZone(),
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Australia/Sydney"
  ])
);
const REMINDER_OPTIONS: Array<{ value: ComposeEventFormState["reminder"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "at_time", label: "At time of event" },
  { value: "5m", label: "5 minutes before" },
  { value: "15m", label: "15 minutes before" },
  { value: "30m", label: "30 minutes before" },
  { value: "1h", label: "1 hour before" },
  { value: "1d", label: "1 day before" }
];

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const INVITEE_INVALID_MESSAGE = "Some addresses could not be added.";

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return new Date();
  }

  return new Date(year, month - 1, day);
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplayValue(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(parseDateInput(value));
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric"
  }).format(date);
}

function buildCalendarDays(visibleMonth: Date) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function looksLikeUrlOrEmail(text: string) {
  const trimmed = text.trimStart();
  return (
    /^(https?:\/\/|www\.)/i.test(trimmed) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+/.test(trimmed)
  );
}

function toSentenceCase(value: string) {
  if (!value.trim() || looksLikeUrlOrEmail(value)) {
    return value;
  }

  const firstLetterIndex = value.search(/[A-Za-z]/);
  if (firstLetterIndex < 0) {
    return value;
  }

  const firstLetter = value[firstLetterIndex];
  const upperFirstLetter = firstLetter.toLocaleUpperCase();
  if (firstLetter === upperFirstLetter) {
    return value;
  }

  return `${value.slice(0, firstLetterIndex)}${upperFirstLetter}${value.slice(firstLetterIndex + 1)}`;
}

function normalizeNotesSentenceCase(value: string) {
  if (!value.trim()) {
    return value;
  }

  let result = "";
  let capitalizeNext = true;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (capitalizeNext && /[A-Za-z]/.test(char)) {
      if (char === char.toLocaleLowerCase()) {
        const tail = value.slice(index);
        if (!looksLikeUrlOrEmail(tail)) {
          result += char.toLocaleUpperCase();
        } else {
          result += char;
        }
      } else {
        result += char;
      }
      capitalizeNext = false;
      continue;
    }

    result += char;

    if (char === "." || char === "!" || char === "?" || char === "\n") {
      capitalizeNext = true;
      continue;
    }

    if (!/\s/.test(char)) {
      capitalizeNext = false;
    }
  }

  return result;
}

function isValidInviteeEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

function parseInviteeToken(token: string): ComposeEventInvitee | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const namedMatch = trimmed.match(/^(.+?)\s*<\s*([^<>]+)\s*>$/);
  if (namedMatch) {
    const name = namedMatch[1]?.trim().replace(/^"+|"+$/g, "");
    const email = namedMatch[2]?.trim().toLowerCase();
    if (!email || !isValidInviteeEmail(email)) {
      return null;
    }
    return name ? { email, name } : { email };
  }

  const email = trimmed.toLowerCase();
  if (!isValidInviteeEmail(email)) {
    return null;
  }
  return { email };
}

function splitInviteeText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .split(/[\n,;]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function addInvitees(
  existing: ComposeEventInvitee[],
  rawInput: string
): { invitees: ComposeEventInvitee[]; hadInvalid: boolean; addedCount: number } {
  const tokens = splitInviteeText(rawInput);
  if (tokens.length === 0) {
    return { invitees: existing, hadInvalid: false, addedCount: 0 };
  }

  const byEmail = new Map(existing.map((invitee) => [invitee.email.toLowerCase(), invitee]));
  let hadInvalid = false;
  let addedCount = 0;

  for (const token of tokens) {
    const parsed = parseInviteeToken(token);
    if (!parsed) {
      hadInvalid = true;
      continue;
    }
    const key = parsed.email.toLowerCase();
    if (byEmail.has(key)) {
      continue;
    }
    byEmail.set(key, parsed);
    addedCount += 1;
  }

  return {
    invitees: Array.from(byEmail.values()),
    hadInvalid,
    addedCount
  };
}

export function ComposeEventBuilder({
  open,
  initialEvent,
  inviteeSuggestions = [],
  onClose,
  onCreate
}: ComposeEventBuilderProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [inviteeInput, setInviteeInput] = useState("");
  const [inviteeError, setInviteeError] = useState<string | null>(null);
  const [openCalendarField, setOpenCalendarField] = useState<"startDate" | "endDate" | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateInput(initialEvent?.startDate ?? ""));
  const [calendarPosition, setCalendarPosition] = useState({
    top: 0,
    left: 0
  });
  const [surfaceFrame, setSurfaceFrame] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const inviteeSuggestionsListId = useId();
  const {
    form,
    errors,
    submitting,
    setSubmitting,
    updateField,
    toggleMultiDay,
    buildEvent
  } = useComposeEventBuilderState(initialEvent, open);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);
  const startDateControlRef = useRef<HTMLButtonElement | null>(null);
  const endDateControlRef = useRef<HTMLButtonElement | null>(null);
  const calendarCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSubmitError(null);
    setInviteeInput("");
    setInviteeError(null);
    setOpenCalendarField(null);
    setVisibleMonth(parseDateInput(initialEvent?.startDate ?? ""));
  }, [initialEvent?.startDate, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const computeSurfaceFrame = () => {
      const composeWindow = document.querySelector(".compose-window:not(.compose-minimized)") as
        | HTMLElement
        | null;
      const anchorRect = composeWindow?.getBoundingClientRect() ?? {
        top: 24,
        left: 24,
        width: Math.max(window.innerWidth - 48, 520),
        height: Math.max(window.innerHeight - 48, 520)
      };

      const viewportPadding = 14;
      const minWidth = 520;
      const maxWidth = Math.max(minWidth, Math.min(660, window.innerWidth - viewportPadding * 2));
      const width = Math.max(
        minWidth,
        Math.min(maxWidth, Math.max(minWidth, Math.min(anchorRect.width - 24, 660)))
      );

      const preferredTop = Math.max(anchorRect.top + 24, viewportPadding);
      const maxTop = Math.max(viewportPadding, window.innerHeight - 440);
      const top = Math.min(preferredTop, maxTop);
      const centeredLeft = anchorRect.left + (anchorRect.width - width) / 2;
      const left = Math.min(
        Math.max(viewportPadding, centeredLeft),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
      );
      const maxHeight = Math.max(460, window.innerHeight - top - viewportPadding);

      setSurfaceFrame({ top, left, width, maxHeight });
    };

    computeSurfaceFrame();
    window.addEventListener("resize", computeSurfaceFrame);
    window.addEventListener("scroll", computeSurfaceFrame, true);
    return () => {
      window.removeEventListener("resize", computeSurfaceFrame);
      window.removeEventListener("scroll", computeSurfaceFrame, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openCalendarField) {
          event.preventDefault();
          setOpenCalendarField(null);
          return;
        }
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, openCalendarField]);

  useEffect(() => {
    if (!openCalendarField) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (calendarCardRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenCalendarField(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openCalendarField]);

  const handleCalendarOpen = (field: "startDate" | "endDate") => {
    const currentValue = field === "startDate" ? form.startDate : form.endDate;
    setVisibleMonth(parseDateInput(currentValue));
    setOpenCalendarField((current) => (current === field ? null : field));
  };

  const handleCalendarSelect = (field: "startDate" | "endDate", date: Date) => {
    updateField(field, formatDateInputValue(date));
    if (field === "startDate" && !form.isMultiDay) {
      updateField("endDate", formatDateInputValue(date));
    }
    setVisibleMonth(date);
    setOpenCalendarField(null);
  };

  const updateCalendarPosition = useCallback(() => {
    if (!openCalendarField) {
      return;
    }

    const modalBody = modalBodyRef.current;
    const anchor =
      openCalendarField === "startDate" ? startDateControlRef.current : endDateControlRef.current;
    if (!modalBody || !anchor) {
      return;
    }

    const modalRect = modalBody.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const cardWidth = 198;
    const edgePadding = 8;
    const desiredLeft = anchorRect.left - modalRect.left;
    const maxLeft = Math.max(edgePadding, modalRect.width - cardWidth - edgePadding);
    const nextLeft = Math.max(edgePadding, Math.min(desiredLeft, maxLeft));
    const nextTop = anchorRect.bottom - modalRect.top + 2;

    setCalendarPosition({
      top: nextTop,
      left: nextLeft
    });
  }, [openCalendarField]);

  useEffect(() => {
    if (!openCalendarField) {
      return;
    }

    const rafId = window.requestAnimationFrame(updateCalendarPosition);
    const handleReposition = () => {
      updateCalendarPosition();
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [openCalendarField, updateCalendarPosition]);

  const normalizeFieldOnBlur = useCallback(
    (
      key: "title" | "location" | "notes",
      value: string,
      normalizer: (input: string) => string
    ) => {
      const normalizedValue = normalizer(value);
      if (normalizedValue !== value) {
        updateField(key, normalizedValue);
      }
    },
    [updateField]
  );
  const handleTitleChange = useCallback(
    (value: string) => {
      updateField("title", toSentenceCase(value));
    },
    [updateField]
  );
  const handleLocationChange = useCallback(
    (value: string) => {
      updateField("location", toSentenceCase(value));
    },
    [updateField]
  );
  const handleNotesChange = useCallback(
    (value: string) => {
      updateField("notes", normalizeNotesSentenceCase(value));
    },
    [updateField]
  );
  const handleInviteeCommit = useCallback(
    (rawValue: string) => {
      const parsed = addInvitees(form.invitees, rawValue);
      if (parsed.addedCount > 0) {
        updateField("invitees", parsed.invitees);
      }
      setInviteeError(parsed.hadInvalid ? INVITEE_INVALID_MESSAGE : null);
      return parsed;
    },
    [form.invitees, updateField]
  );
  const removeInvitee = useCallback(
    (email: string) => {
      updateField(
        "invitees",
        form.invitees.filter((invitee) => invitee.email.toLowerCase() !== email.toLowerCase())
      );
      setInviteeError(null);
    },
    [form.invitees, updateField]
  );
  const filteredInviteeSuggestions = useMemo(() => {
    const input = inviteeInput.trim().toLowerCase();
    const existing = new Set(form.invitees.map((invitee) => invitee.email.toLowerCase()));
    return inviteeSuggestions
      .filter((suggestion) => {
        const suggestionText = suggestion.trim();
        if (!suggestionText) {
          return false;
        }
        const parsed = parseInviteeToken(suggestionText);
        if (!parsed || existing.has(parsed.email.toLowerCase())) {
          return false;
        }
        if (!input) {
          return true;
        }
        return suggestionText.toLowerCase().includes(input);
      })
      .slice(0, 8);
  }, [form.invitees, inviteeInput, inviteeSuggestions]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const calendarDays = buildCalendarDays(visibleMonth);
  const activeCalendarValue = openCalendarField === "endDate" ? form.endDate : form.startDate;
  const selectedCalendarDate = parseDateInput(activeCalendarValue);
  const timezoneOptions = Array.from(
    new Set(
      form.timezone && form.timezone.trim().length > 0
        ? [form.timezone, ...TIMEZONE_SUGGESTIONS]
        : TIMEZONE_SUGGESTIONS
    )
  );
  const timezoneWidthCh = Math.min(
    Math.max(
      timezoneOptions.reduce((maxChars, timezone) => Math.max(maxChars, timezone.length), 0) + 3,
      16
    ),
    30
  );
  const reminderWidthCh = Math.min(
    Math.max(
      REMINDER_OPTIONS.reduce((maxChars, option) => Math.max(maxChars, option.label.length), 0) + 3,
      14
    ),
    24
  );

  const handleSubmit = async () => {
    setSubmitError(null);
    const event = buildEvent();
    if (!event) {
      return;
    }

    const asset = generateICSFromComposeEvent(event);
    setSubmitting(true);

    try {
      await onCreate({
        event,
        form,
        asset
      });
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unable to attach the calendar invite."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="modal-overlay compose-event-overlay"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="modal compose-event-popover compose-event-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-event-title"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        style={
          surfaceFrame
            ? {
                top: `${surfaceFrame.top}px`,
                left: `${surfaceFrame.left}px`,
                width: `${surfaceFrame.width}px`,
                maxHeight: `${surfaceFrame.maxHeight}px`
              }
            : undefined
        }
      >
        <div className="compose-event-header">
          <div className="compose-event-header-copy">
            <div className="compose-event-title" id="compose-event-title">
              Create calendar event
            </div>
            <div className="compose-event-copy">
              Add a calendar invite directly to this draft.
            </div>
          </div>
          <button
            type="button"
            className="compose-event-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="compose-event-modal-body" ref={modalBodyRef}>
          <label className="compose-event-field compose-event-title-row">
            <span className="compose-event-label">Title</span>
            <input
              id="compose-event-title-input"
              aria-label="Title"
              className={`compose-event-input compose-event-title-input ${
                errors.title ? "compose-event-input-error" : ""
              }`}
              type="text"
              value={form.title}
              onChange={(event) => handleTitleChange(event.target.value)}
              onBlur={() => normalizeFieldOnBlur("title", form.title, toSentenceCase)}
              placeholder="Title"
              autoFocus
            />
            {errors.title ? (
              <span className="compose-event-error compose-event-title-error">{errors.title}</span>
            ) : null}
          </label>

          <div className="compose-event-field compose-event-invitees-field">
            <span className="compose-event-label">Invitees</span>
            <div className="compose-event-invitees-shell">
              {form.invitees.map((invitee) => (
                <span key={invitee.email} className="compose-event-invitee-chip">
                  <span className="compose-event-invitee-chip-text">
                    {invitee.name ? `${invitee.name} <${invitee.email}>` : invitee.email}
                  </span>
                  <button
                    type="button"
                    className="compose-event-invitee-chip-remove"
                    onClick={() => removeInvitee(invitee.email)}
                    aria-label={`Remove ${invitee.email}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="compose-event-invitees-input"
                type="text"
                value={inviteeInput}
                placeholder={form.invitees.length === 0 ? "Add invitees" : "Add more invitees"}
                autoComplete="email"
                list={filteredInviteeSuggestions.length > 0 ? inviteeSuggestionsListId : undefined}
                onChange={(event) => setInviteeInput(event.target.value)}
                onBlur={() => {
                  if (inviteeInput.trim().length === 0) {
                    return;
                  }
                  const parsed = handleInviteeCommit(inviteeInput);
                  if (parsed.addedCount > 0 || parsed.hadInvalid) {
                    setInviteeInput("");
                  }
                }}
                onPaste={(event) => {
                  const pastedText = event.clipboardData.getData("text");
                  if (!pastedText || !/[\n,;]|@/.test(pastedText)) {
                    return;
                  }
                  event.preventDefault();
                  const parsed = handleInviteeCommit(pastedText);
                  if (parsed.addedCount > 0 || parsed.hadInvalid) {
                    setInviteeInput("");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && inviteeInput.length === 0 && form.invitees.length > 0) {
                    event.preventDefault();
                    removeInvitee(form.invitees[form.invitees.length - 1].email);
                    return;
                  }

                  if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
                    if (inviteeInput.trim().length === 0) {
                      return;
                    }
                    event.preventDefault();
                    const parsed = handleInviteeCommit(inviteeInput);
                    if (parsed.addedCount > 0 || parsed.hadInvalid) {
                      setInviteeInput("");
                    }
                  }
                }}
              />
              {filteredInviteeSuggestions.length > 0 ? (
                <datalist id={inviteeSuggestionsListId}>
                  {filteredInviteeSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              ) : null}
            </div>
            {inviteeError ? (
              <span className="compose-event-error">{inviteeError}</span>
            ) : form.invitees.length === 0 ? (
              <span className="compose-event-note">Leave blank to create a personal event.</span>
            ) : null}
          </div>

          <div className="compose-event-schedule-grid">
            <div className="compose-event-row compose-event-row-date">
              <div className="compose-event-field compose-event-field-date">
                <span className="compose-event-label">Date</span>
                <button
                  type="button"
                  ref={startDateControlRef}
                  className={`compose-event-input compose-event-date-control ${
                    errors.startDate ? "compose-event-input-error" : ""
                  } ${openCalendarField === "startDate" ? "is-open" : ""}`}
                  aria-expanded={openCalendarField === "startDate"}
                  onClick={() => handleCalendarOpen("startDate")}
                >
                  <span className="compose-event-date-text">{formatDateDisplayValue(form.startDate)}</span>
                  <span className="compose-event-date-glyph" aria-hidden="true">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="17" rx="2" />
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <path d="M3 10h18" />
                    </svg>
                  </span>
                </button>
                {errors.startDate ? <span className="compose-event-error">{errors.startDate}</span> : null}
              </div>

              <button
                type="button"
                className={`compose-event-toggle compose-event-toggle-compact ${
                  form.isMultiDay ? "is-on" : ""
                }`}
                onClick={() => toggleMultiDay(!form.isMultiDay)}
              >
                <span className="compose-event-toggle-track" aria-hidden="true">
                  <span className="compose-event-toggle-thumb" />
                </span>
                Multi-day
              </button>
            </div>

            <div className="compose-event-row compose-event-row-time">
              <div
                className={`compose-event-time-cluster ${
                  form.isMultiDay ? "compose-event-time-cluster-flat" : ""
                }`}
              >
                <label className="compose-event-field compose-event-time-field">
                  <span className="compose-event-label">Start time</span>
                  <input
                    className={`compose-event-input ${
                      errors.startTime ? "compose-event-input-error" : ""
                    }`}
                    type="time"
                    value={form.startTime}
                    onChange={(event) => updateField("startTime", event.target.value)}
                  />
                  {errors.startTime ? <span className="compose-event-error">{errors.startTime}</span> : null}
                </label>

                {!form.isMultiDay ? (
                  <label className="compose-event-field compose-event-time-field">
                    <span className="compose-event-label">End time</span>
                    <input
                      className={`compose-event-input ${
                        errors.endTime ? "compose-event-input-error" : ""
                      }`}
                      type="time"
                      value={form.endTime}
                      onChange={(event) => updateField("endTime", event.target.value)}
                    />
                    {errors.endTime ? <span className="compose-event-error">{errors.endTime}</span> : null}
                  </label>
                ) : null}
              </div>
            </div>

            {form.isMultiDay ? (
              <>
                <div className="compose-event-row compose-event-row-enddate compose-event-end-cluster">
                  <div className="compose-event-field compose-event-field-enddate">
                    <span className="compose-event-label">End date</span>
                    <button
                      type="button"
                      ref={endDateControlRef}
                      className={`compose-event-input compose-event-date-control ${
                        errors.endDate ? "compose-event-input-error" : ""
                      } ${openCalendarField === "endDate" ? "is-open" : ""}`}
                      aria-expanded={openCalendarField === "endDate"}
                      onClick={() => handleCalendarOpen("endDate")}
                    >
                      <span className="compose-event-date-text">{formatDateDisplayValue(form.endDate)}</span>
                      <span className="compose-event-date-glyph" aria-hidden="true">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="4" width="18" height="17" rx="2" />
                          <path d="M8 2v4" />
                          <path d="M16 2v4" />
                          <path d="M3 10h18" />
                        </svg>
                      </span>
                    </button>
                    {errors.endDate ? <span className="compose-event-error">{errors.endDate}</span> : null}
                  </div>
                  <label className="compose-event-field compose-event-time-field compose-event-end-time-field">
                    <span className="compose-event-label">End time</span>
                    <input
                      className={`compose-event-input ${
                        errors.endTime ? "compose-event-input-error" : ""
                      }`}
                      type="time"
                      value={form.endTime}
                      onChange={(event) => updateField("endTime", event.target.value)}
                    />
                    {errors.endTime ? <span className="compose-event-error">{errors.endTime}</span> : null}
                  </label>
                </div>
              </>
            ) : null}

            <div className="compose-event-utility-row">
              <label className="compose-event-field compose-event-timezone-field">
                <span className="compose-event-label">Time zone</span>
                <select
                  className={`compose-event-input compose-event-timezone-input ${
                    errors.timezone ? "compose-event-input-error" : ""
                  }`}
                  value={form.timezone}
                  onChange={(event) => updateField("timezone", event.target.value)}
                  style={{ width: `${timezoneWidthCh}ch` }}
                >
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="compose-event-details-row">
              <label className="compose-event-field compose-event-location-field">
                <span className="compose-event-label">Location</span>
                <input
                  className="compose-event-input"
                  type="text"
                  value={form.location}
                  onChange={(event) => handleLocationChange(event.target.value)}
                  onBlur={() => normalizeFieldOnBlur("location", form.location, toSentenceCase)}
                  placeholder="Conference room or address"
                />
              </label>

              <label className="compose-event-field compose-event-reminder-field">
                <span className="compose-event-label">Reminder</span>
                <select
                  className="compose-event-input compose-event-reminder-input"
                  value={form.reminder}
                  onChange={(event) =>
                    updateField("reminder", event.target.value as ComposeEventFormState["reminder"])
                  }
                  style={{ width: `${reminderWidthCh}ch` }}
                >
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="compose-event-field compose-event-notes-field">
              <span className="compose-event-label">Notes</span>
              <textarea
                className="compose-event-input compose-event-textarea"
                value={form.notes}
                onChange={(event) => handleNotesChange(event.target.value)}
                onBlur={() =>
                  normalizeFieldOnBlur("notes", form.notes, normalizeNotesSentenceCase)
                }
                placeholder="Agenda, meeting link, or anything attendees should know"
              />
            </label>
          </div>

          {openCalendarField ? (
            <div
              className="compose-event-calendar-floating"
              ref={calendarCardRef}
              style={{
                top: `${calendarPosition.top}px`,
                left: `${calendarPosition.left}px`
              }}
            >
              <div className="compose-event-calendar-card">
                <div className="compose-event-calendar-toolbar">
                  <div className="compose-event-calendar-selection">
                    {formatDateDisplayValue(activeCalendarValue)}
                  </div>
                  <div className="compose-event-calendar-nav">
                    <button
                      type="button"
                      className="compose-event-calendar-nav-button"
                      aria-label="Previous month"
                      onClick={() =>
                        setVisibleMonth(
                          new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1)
                        )
                      }
                    >
                      ‹
                    </button>
                    <div className="compose-event-calendar-month">{formatMonthLabel(visibleMonth)}</div>
                    <button
                      type="button"
                      className="compose-event-calendar-nav-button"
                      aria-label="Next month"
                      onClick={() =>
                        setVisibleMonth(
                          new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)
                        )
                      }
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="compose-event-calendar-weekdays">
                  {WEEKDAY_LABELS.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="compose-event-calendar-grid">
                  {calendarDays.map((day) => {
                    const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
                    const isSelected =
                      day.getFullYear() === selectedCalendarDate.getFullYear() &&
                      day.getMonth() === selectedCalendarDate.getMonth() &&
                      day.getDate() === selectedCalendarDate.getDate();

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        className={`compose-event-calendar-day ${
                          isCurrentMonth ? "" : "is-outside"
                        } ${isSelected ? "is-selected" : ""}`}
                        onClick={() => handleCalendarSelect(openCalendarField, day)}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="compose-event-modal-footer">
          <div className="compose-event-footer-meta">
            <div className="compose-event-copy compose-event-footer-copy">
              {form.invitees.length > 0
                ? "An invite will be attached as an ICS file for recipients."
                : "Event details will be attached as an ICS file."}
            </div>
            {submitError ? (
              <div className="compose-event-submit-error" role="alert">
                {submitError}
              </div>
            ) : null}
          </div>
          <div className="compose-event-actions">
            <button
              type="button"
              className="compose-event-action-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="compose-event-action-primary"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Creating..." : "Create event"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
