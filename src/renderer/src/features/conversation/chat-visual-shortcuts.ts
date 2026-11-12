import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import { matchShortcut } from "@openbot/ui/features/shortcuts/shortcut-registry";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { isOpenSettingsShortcut } from "../settings/settings-shortcut";

/**
 * The app chords that work while a page has the focus. A plain key such as `?` stays in the page,
 * as do the edit keys the page needs, such as ⌘C.
 */
const PAGE_APP_SHORTCUTS = [
  "shortcuts",
  "newChat",
  "toggleSidebar",
  "previousChat",
  "nextChat",
  "previousUnreadChat",
  "nextUnreadChat",
  "stopAgent",
] as const;

/**
 * The app shortcuts that a visual reply's page gives to the app while the page has the focus:
 * search, Settings, a server by its number, and the chat and view chords of the shortcut list. The
 * page does not say which system it runs on, so a chord of either system counts. The app's own
 * handlers then check the key again. Any other chord stays in the page.
 */
export function isChatVisualAppShortcut(key: ChatVisualKey): boolean {
  if (isGlobalSearchShortcut(key) || isOpenSettingsShortcut(key)) return true;
  if (
    matchShortcut(PAGE_APP_SHORTCUTS, key, "mac", true) !== undefined ||
    matchShortcut(PAGE_APP_SHORTCUTS, key, "pc", true) !== undefined
  ) {
    return true;
  }
  return (key.metaKey || key.ctrlKey) && !key.altKey && !key.shiftKey && /^[1-9]$/u.test(key.key);
}
