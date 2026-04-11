"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

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

export function ComposeEventBuilder({
  open,
  initialEvent,
  onClose,
  onCreate
}: ComposeEventBuilderProps) {
  const {
    form,
    errors,
    submitting,
    setSubmitting,
    updateField,
    toggleMultiDay,
    buildEvent
  } = useComposeEventBuilderState(initialEvent, open);
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const endDateInputRef = useRef<HTMLInputElement | null>(null);

  const openDatePicker = (input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.focus();
    input.click();
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleSubmit = async () => {
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
          <div>
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
              <label className="sr-only" htmlFor="compose-event-title-input">
                Event details
              </label>
              <input
                id="compose-event-title-input"
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

          <div className="compose-event-schedule-grid">
            <div className="compose-event-row compose-event-row-date">
              <div className="compose-event-field compose-event-field-date">
                <span className="compose-event-label">Date</span>
                <div className="compose-event-input-shell">
                  <input
                    ref={startDateInputRef}
                    className={`compose-event-input compose-event-date-input ${
                      errors.startDate ? "compose-event-input-error" : ""
                    }`}
                      type="date"
                      value={form.startDate}
                      onChange={(event) => updateField("startDate", event.target.value)}
                    />
                    <button
                      type="button"
                      className="compose-event-icon-button compose-event-date-trigger"
                      aria-label="Open date picker"
                      onClick={() => openDatePicker(startDateInputRef.current)}
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

            <div className="compose-event-row compose-event-row-time">
              <label className="compose-event-field">
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

              <label className="compose-event-field">
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

            {form.isMultiDay ? (
              <div className="compose-event-row compose-event-row-enddate">
                <div className="compose-event-field compose-event-field-enddate">
                  <span className="compose-event-label">End date</span>
                  <div className="compose-event-input-shell">
                    <input
                      ref={endDateInputRef}
                      className={`compose-event-input compose-event-date-input ${
                        errors.endDate ? "compose-event-input-error" : ""
                      }`}
                      type="date"
                      value={form.endDate}
                      onChange={(event) => updateField("endDate", event.target.value)}
                    />
                    <button
                      type="button"
                      className="compose-event-icon-button compose-event-date-trigger"
                      aria-label="Open end date picker"
                      onClick={() => openDatePicker(endDateInputRef.current)}
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
          <div className="compose-event-copy">Event data will be attached as an ICS file.</div>
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
