import { useEffect, useRef, useState } from "react";

import {
  buildComposeEventFromForm,
  createDefaultComposeEventFormState,
  validateComposeEventForm
} from "@/composer/events/state";
import type {
  ComposeEventFormState,
  ComposeEventValidationErrors
} from "@/composer/events/types";

function normalizeInitialFormState(initialEvent: ComposeEventFormState | null): ComposeEventFormState {
  const fallback = createDefaultComposeEventFormState();
  if (!initialEvent) {
    return fallback;
  }
  return {
    ...fallback,
    ...initialEvent,
    invitees: Array.isArray(initialEvent.invitees)
      ? initialEvent.invitees
          .filter((invitee) => typeof invitee?.email === "string")
          .map((invitee) => ({
            email: invitee.email.trim(),
            name: typeof invitee.name === "string" ? invitee.name.trim() : undefined
          }))
          .filter((invitee) => invitee.email.length > 0)
      : []
  };
}

function addOneDayToDateInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  date.setDate(date.getDate() + 1);

  const nextYear = date.getFullYear();
  const nextMonth = `${date.getMonth() + 1}`.padStart(2, "0");
  const nextDay = `${date.getDate()}`.padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function useComposeEventBuilderState(initialEvent: ComposeEventFormState | null, open: boolean) {
  const [form, setForm] = useState<ComposeEventFormState>(() =>
    normalizeInitialFormState(initialEvent)
  );
  const [errors, setErrors] = useState<ComposeEventValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const savedTimedValuesRef = useRef<{
    startTime: string;
    endTime: string;
  } | null>(null);
  const endDateUserEditedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextInitial = normalizeInitialFormState(initialEvent);
    setForm(nextInitial);
    setErrors({});
    setSubmitting(false);
    savedTimedValuesRef.current = null;
    endDateUserEditedRef.current = false;
  }, [initialEvent, open]);

  const updateField = <K extends keyof ComposeEventFormState>(
    key: K,
    value: ComposeEventFormState[K]
  ) => {
    setForm((current) => {
      if (key === "startDate" && typeof value === "string") {
        const nextStartDate = value;
        const nextEndDate =
          current.isMultiDay && endDateUserEditedRef.current
            ? current.endDate
            : current.isMultiDay
              ? addOneDayToDateInput(nextStartDate)
              : nextStartDate;

        return {
          ...current,
          startDate: nextStartDate,
          endDate: nextEndDate
        };
      }

      if (key === "endDate" && typeof value === "string") {
        endDateUserEditedRef.current = value !== current.startDate;
      }

      if (key === "isMultiDay" && typeof value === "boolean") {
        if (value) {
          endDateUserEditedRef.current = false;
          return {
            ...current,
            isMultiDay: true,
            endDate: addOneDayToDateInput(current.startDate)
          };
        }

        endDateUserEditedRef.current = false;
        return {
          ...current,
          isMultiDay: false,
          endDate: current.startDate
        };
      }

      return { ...current, [key]: value };
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const toggleMultiDay = (nextValue: boolean) => {
    setForm((current) => {
      if (nextValue === current.isMultiDay) {
        return current;
      }

      if (nextValue) {
        savedTimedValuesRef.current = {
          startTime: current.startTime,
          endTime: current.endTime
        };
        endDateUserEditedRef.current = false;

        return {
          ...current,
          isMultiDay: true,
          endDate: addOneDayToDateInput(current.startDate)
        };
      }

      const restore = savedTimedValuesRef.current;
      endDateUserEditedRef.current = false;
      return {
        ...current,
        isMultiDay: false,
        endDate: current.startDate,
        startTime: restore?.startTime ?? current.startTime,
        endTime: restore?.endTime ?? current.endTime
      };
    });
  };

  const resetToInitial = () => {
    const nextInitial = normalizeInitialFormState(initialEvent);
    setForm(nextInitial);
    setErrors({});
    setSubmitting(false);
    savedTimedValuesRef.current = null;
    endDateUserEditedRef.current = false;
  };

  const buildEvent = () => {
    const nextValidation = validateComposeEventForm(form);
    setErrors(nextValidation);

    if (Object.keys(nextValidation).length > 0) {
      return null;
    }

    return buildComposeEventFromForm(form);
  };

  return {
    form,
    setForm,
    errors,
    setErrors,
    submitting,
    setSubmitting,
    updateField,
    toggleMultiDay,
    resetToInitial,
    buildEvent
  };
}
