import { shortcutMatches } from "@openbot/ui/features/shortcuts/shortcut-registry";

/**
 * Cmd+K on macOS and Ctrl+K elsewhere, without Alt or Shift, opens and closes the global search. Either
 * key works on both systems. A browser autofill sends a keydown with no `key`, so the key is read with care.
 */
export function isGlobalSearchShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  return shortcutMatches("search", event, "mac");
}
