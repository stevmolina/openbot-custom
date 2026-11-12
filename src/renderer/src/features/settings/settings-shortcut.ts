import { type ShortcutKeyEvent, shortcutMatches } from "@openbot/ui/features/shortcuts/shortcut-registry";

/**
 * The Settings shortcut: `Cmd + ,` on macOS, `Ctrl + ,` elsewhere. It fires from any focused
 * control, including a text field, because the native Preferences item it mirrors does the same.
 */
export function isOpenSettingsShortcut(event: ShortcutKeyEvent): boolean {
  return shortcutMatches("settings", event, "mac");
}
