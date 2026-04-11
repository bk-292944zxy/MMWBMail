"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { generateICSFromComposeEvent } from "@/composer/events/ics";
import { getDefaultComposeEventTimeZone } from "@/composer/events/state";
import { useComposeEventBuilderState } from "@/composer/events/use-compose-event-builder-state";
import type {
  ComposeEvent,
  ComposeEventFormState,
  GeneratedEventAsset
} from "@/composer/events/types";

type ComposeEventBuilderProps = {
  open: boolean;
  initialEvent: ComposeEventFormState | null;
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

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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

export function ComposeEventBuilder({
  open,
  initialEvent,
  onClose,
  onCreate
}: ComposeEventBuilderProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [openCalendarField, setOpenCalendarField] = useState<"startDate" | "endDate" | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateInput(initialEvent?.startDate ?? ""));
  const {
    form,
    errors,
    submitting,
    setSubmitting,
    updateField,
    toggleMultiDay,
    buildEvent
  } = useComposeEventBuilderState(initialEvent, open);
  const calendarCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSubmitError(null);
    setOpenCalendarField(null);
    setVisibleMonth(parseDateInput(initialEvent?.startDate ?? ""));
  }, [initialEvent?.startDate, open]);

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

  if (!open || typeof document === "undefined") {
    return null;
  }

  const calendarDays = buildCalendarDays(visibleMonth);
  const activeCalendarValue = openCalendarField === "endDate" ? form.endDate : form.startDate;
  const selectedCalendarDate = parseDateInput(activeCalendarValue);

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

        <div className="compose-event-modal-body">
          <div className="compose-event-title-row">
            <div className="compose-event-title-shell">
              <div
                className="compose-event-title-glyph"
                aria-hidden="true"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="17" rx="2" />
                  <path d="M8 2v4" />
                  <path d="M16 2v4" />
                  <path d="M3 10h18" />
                </svg>
              </div>
              <div className="compose-event-title-field">
                <input
                  id="compose-event-title-input"
                  aria-label="Event details"
                  className={`compose-event-input compose-event-title-input ${
                    errors.title ? "compose-event-input-error" : ""
                  }`}
                  type="text"
                  value={form.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="Event details"
                  autoFocus
                />
                {errors.title ? (
                  <span className="compose-event-error compose-event-title-error">{errors.title}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="compose-event-schedule-grid">
            <div className="compose-event-row compose-event-row-date">
              <div className="compose-event-field compose-event-field-date">
                <span className="compose-event-label">Date</span>
                <div className="compose-event-input-shell">
                  <button
                    type="button"
                    className={`compose-event-input compose-event-date-display ${
                      errors.startDate ? "compose-event-input-error" : ""
                    }`}
                    aria-expanded={openCalendarField === "startDate"}
                    onClick={() => handleCalendarOpen("startDate")}
                  >
                    {formatDateDisplayValue(form.startDate)}
                  </button>
                  <button
                    type="button"
                    className="compose-event-icon-button compose-event-date-trigger"
                    aria-label="Open date picker"
                    onClick={() => handleCalendarOpen("startDate")}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="17" rx="2" />
                      <path d="M8 2v4" />
                      <path d="M16 2v4" />
                      <path d="M3 10h18" />
                    </svg>
                  </button>
                </div>
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

            {openCalendarField === "startDate" ? (
              <div className="compose-event-calendar-inline">
                <div className="compose-event-calendar-card" ref={calendarCardRef}>
                  <div className="compose-event-calendar-toolbar">
                    <div className="compose-event-calendar-selection">
                      {formatDateDisplayValue(form.startDate)}
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
                          onClick={() => handleCalendarSelect("startDate", day)}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="compose-event-row compose-event-row-time">
              <div className="compose-event-time-cluster">
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
              </div>
            </div>

            {form.isMultiDay ? (
              <>
                <div className="compose-event-row compose-event-row-enddate">
                  <div className="compose-event-field compose-event-field-enddate">
                    <span className="compose-event-label">End date</span>
                    <div className="compose-event-input-shell">
                      <button
                        type="button"
                        className={`compose-event-input compose-event-date-display ${
                          errors.endDate ? "compose-event-input-error" : ""
                        }`}
                        aria-expanded={openCalendarField === "endDate"}
                        onClick={() => handleCalendarOpen("endDate")}
                      >
                        {formatDateDisplayValue(form.endDate)}
                      </button>
                      <button
                        type="button"
                        className="compose-event-icon-button compose-event-date-trigger"
                        aria-label="Open end date picker"
                        onClick={() => handleCalendarOpen("endDate")}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="3" y="4" width="18" height="17" rx="2" />
                          <path d="M8 2v4" />
                          <path d="M16 2v4" />
                          <path d="M3 10h18" />
                        </svg>
                      </button>
                    </div>
                    {errors.endDate ? <span className="compose-event-error">{errors.endDate}</span> : null}
                  </div>
                </div>

                {openCalendarField === "endDate" ? (
                  <div className="compose-event-calendar-inline">
                    <div className="compose-event-calendar-card" ref={calendarCardRef}>
                      <div className="compose-event-calendar-toolbar">
                        <div className="compose-event-calendar-selection">
                          {formatDateDisplayValue(form.endDate)}
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
                              onClick={() => handleCalendarSelect("endDate", day)}
                            >
                              {day.getDate()}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="compose-event-utility-row">
              <label className="compose-event-field compose-event-timezone-field">
                <span className="compose-event-label">Time zone</span>
                <input
                  className={`compose-event-input compose-event-timezone-input ${
                    errors.timezone ? "compose-event-input-error" : ""
                  }`}
                  type="text"
                  list="compose-event-timezones"
                  value={form.timezone}
                  onChange={(event) => updateField("timezone", event.target.value)}
                  placeholder="America/New_York"
                />
              </label>
            </div>

            <div className="compose-event-details-row">
              <label className="compose-event-field compose-event-location-field">
                <span className="compose-event-label">Location</span>
                <input
                  className="compose-event-input"
                  type="text"
                  value={form.location}
                  onChange={(event) => updateField("location", event.target.value)}
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
                >
                  <option value="none">None</option>
                  <option value="at_time">At time of event</option>
                  <option value="5m">5 minutes before</option>
                  <option value="15m">15 minutes before</option>
                  <option value="30m">30 minutes before</option>
                  <option value="1h">1 hour before</option>
                  <option value="1d">1 day before</option>
                </select>
              </label>
            </div>

            <label className="compose-event-field compose-event-notes-field">
              <span className="compose-event-label">Notes</span>
              <textarea
                className="compose-event-input compose-event-textarea"
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                placeholder="Agenda, meeting link, or anything attendees should know"
              />
            </label>
          </div>
        </div>

        <div className="compose-event-modal-footer">
          <div className="compose-event-footer-meta">
            <div className="compose-event-copy compose-event-footer-copy">
              Event data will be attached as an ICS file.
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

        <datalist id="compose-event-timezones">
          {TIMEZONE_SUGGESTIONS.map((timezone) => (
            <option key={timezone} value={timezone} />
          ))}
        </datalist>
      </div>
    </div>,
    document.body
  );
}
