import type { ComposerCommandId } from "@/composer/commands/types";
import { COMPOSER_DEFAULT_TOOLBAR_ORDER } from "@/composer/toolbar/default-toolbar";

export type ComposerToolbarPreferences = {
  order: ComposerCommandId[];
  hidden: ComposerCommandId[];
  mode: "expanded" | "compact";
};

const STORAGE_KEY = "maximail-compose-toolbar";

const DEFAULT_PREFERENCES: ComposerToolbarPreferences = {
  order: COMPOSER_DEFAULT_TOOLBAR_ORDER,
  hidden: [
    "insert_thanks",
    "insert_follow_up",
    "insert_meeting_request",
    "schedule_send",
    "print_message"
  ],
  mode: "compact"
};

function dedupe(ids: ComposerCommandId[]) {
  return Array.from(new Set(ids));
}

function moveCommandBefore(
  order: ComposerCommandId[],
  commandId: ComposerCommandId,
  anchorId: ComposerCommandId
) {
  const next = [...order];
  const currentIndex = next.indexOf(commandId);
  const anchorIndex = next.indexOf(anchorId);

  if (currentIndex === -1 || anchorIndex === -1 || currentIndex < anchorIndex) {
    return next;
  }

  next.splice(currentIndex, 1);
  const nextAnchorIndex = next.indexOf(anchorId);
  next.splice(nextAnchorIndex, 0, commandId);
  return next;
}

export function normalizeToolbarPreferences(
  input?: Partial<ComposerToolbarPreferences> | null
): ComposerToolbarPreferences {
  const order = dedupe([
    ...(input?.order ?? []),
    ...COMPOSER_DEFAULT_TOOLBAR_ORDER
  ]).filter((id): id is ComposerCommandId =>
    COMPOSER_DEFAULT_TOOLBAR_ORDER.includes(id)
  );
  const migratedOrder = moveCommandBefore(
    moveCommandBefore(order, "create_calendar_event", "rewrite_for_outcome"),
    "attach_file",
    "rewrite_for_outcome"
  );
  const hidden = dedupe(input?.hidden ?? []).filter((id): id is ComposerCommandId =>
    COMPOSER_DEFAULT_TOOLBAR_ORDER.includes(id)
  );
  const mode = input?.mode === "compact" ? "compact" : "expanded";

  return { order: migratedOrder, hidden, mode };
}

export function loadComposerToolbarPreferences(): ComposerToolbarPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    // Migrate from old key name if present
    const legacy = window.localStorage.getItem("mmwbmail-compose-toolbar");
    if (legacy) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      window.localStorage.removeItem("mmwbmail-compose-toolbar");
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }

    return normalizeToolbarPreferences(
      JSON.parse(raw) as Partial<ComposerToolbarPreferences>
    );
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function persistComposerToolbarPreferences(
  preferences: ComposerToolbarPreferences
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeToolbarPreferences(preferences))
    );
  } catch {
    // Ignore preference persistence failures.
  }
}

export function moveToolbarCommand(
  preferences: ComposerToolbarPreferences,
  commandId: ComposerCommandId,
  direction: "up" | "down"
): ComposerToolbarPreferences {
  const order = [...preferences.order];
  const currentIndex = order.indexOf(commandId);
  if (currentIndex === -1) {
    return preferences;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= order.length) {
    return preferences;
  }

  const nextOrder = [...order];
  const [item] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(targetIndex, 0, item);

  return normalizeToolbarPreferences({
    ...preferences,
    order: nextOrder
  });
}

export function toggleToolbarCommandHidden(
  preferences: ComposerToolbarPreferences,
  commandId: ComposerCommandId
): ComposerToolbarPreferences {
  const hidden = new Set(preferences.hidden);
  if (hidden.has(commandId)) {
    hidden.delete(commandId);
  } else {
    hidden.add(commandId);
  }

  return normalizeToolbarPreferences({
    ...preferences,
    hidden: Array.from(hidden)
  });
}

export function resetComposerToolbarPreferences(): ComposerToolbarPreferences {
  return DEFAULT_PREFERENCES;
}
