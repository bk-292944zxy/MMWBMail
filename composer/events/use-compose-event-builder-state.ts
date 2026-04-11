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

export function useComposeEventBuilderState(initialEvent: ComposeEventFormState | null, open: boolean) {
  const [form, setForm] = useState<ComposeEventFormState>(() =>
    initialEvent ?? createDefaultComposeEventFormState()
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

    const nextInitial = initialEvent ?? createDefaultComposeEventFormState();
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
          current.isMultiDay && endDateUserEditedRef.current ? current.endDate : nextStartDate;

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
          return {
            ...current,
            isMultiDay: true,
            endDate: endDateUserEditedRef.current ? current.endDate : current.startDate
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

        return {
          ...current,
          isMultiDay: true,
          endDate: endDateUserEditedRef.current ? current.endDate : current.startDate
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
    const nextInitial = initialEvent ?? createDefaultComposeEventFormState();
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
