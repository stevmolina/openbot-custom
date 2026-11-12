import { isOneOf } from "./runtime-values";

/**
 * The commands of the app's keyboard shortcuts that a native menu item can also run. The renderer
 * owns each key, so the menu item only shows the key and sends its command to the focused window.
 * A command is a name, never text: the window that runs it reads its own state.
 */
export const APP_SHORTCUT_COMMANDS = [
  "newChat",
  "search",
  "shortcuts",
  "toggleSidebar",
  "previousChat",
  "nextChat",
  "previousUnreadChat",
  "nextUnreadChat",
  "historyBack",
  "historyForward",
  "focusComposer",
  "findInChat",
  "copyLastReply",
  "copyLastCode",
  "stopAgent",
] as const;

export type AppShortcutCommand = (typeof APP_SHORTCUT_COMMANDS)[number];

export function isAppShortcutCommand(value: unknown): value is AppShortcutCommand {
  return isOneOf(APP_SHORTCUT_COMMANDS, value);
}
