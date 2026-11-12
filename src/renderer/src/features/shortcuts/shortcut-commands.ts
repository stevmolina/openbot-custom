/**
 * The commands of the app's own keyboard shortcuts, and the one window listener that runs them. A
 * command runs from its key or from its native menu item, so both reach the same handler.
 *
 * The state a command acts on lives in different parts of the window: the sidebar opens a new chat,
 * the open conversation copies its last reply. Each part registers its handler while it is mounted,
 * and the newest handler that takes the command wins. A handler that returns false passes the
 * command on, such as a conversation that has no reply to copy behind one that is covered.
 *
 * The keys that older parts own (search, Settings, Back and Forward, the server numbers, Find) keep
 * their own listeners. They match the same entries of the shortcut list.
 */

import type { AppShortcutCommand } from "@openbot/contracts/app-shortcut";
import {
  isEditableTarget,
  matchShortcut,
  type ShortcutId,
  type ShortcutPlatform,
} from "@openbot/ui/features/shortcuts/shortcut-registry";

/** A menu command, or a printable key typed while nothing takes text: it goes to the message box. */
export type ShortcutCommand = AppShortcutCommand | "typeToComposer";

type ShortcutHandler = () => boolean | undefined;

const handlers = new Map<ShortcutCommand, ShortcutHandler[]>();

/** Adds a handler while its part is mounted. Returns the removal. */
export function onShortcutCommand(command: ShortcutCommand, handler: ShortcutHandler): () => void {
  const list = handlers.get(command) ?? [];
  list.push(handler);
  handlers.set(command, list);
  return () => {
    const current = handlers.get(command);
    const index = current?.indexOf(handler) ?? -1;
    if (current && index >= 0) current.splice(index, 1);
  };
}

/** Runs the newest handler that takes the command. False when none did. */
export function runShortcutCommand(command: ShortcutCommand): boolean {
  const list = handlers.get(command) ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.() !== false) return true;
  }
  return false;
}

/** The keys this listener owns. Each one is also a command. */
const OWNED_KEYS = [
  "shortcuts",
  "newChat",
  "toggleSidebar",
  "previousChat",
  "nextChat",
  "previousUnreadChat",
  "nextUnreadChat",
  "focusComposer",
  "copyLastReply",
  "copyLastCode",
  "stopAgent",
] as const satisfies readonly (ShortcutId & AppShortcutCommand)[];

/** A dialog or a menu keeps its keys: Escape, arrows and letters belong to it. */
const KEY_OWNERS = "[role='dialog'], [role='alertdialog'], [role='menu']";

/**
 * Controls that use letters or arrows themselves. A key typed there stays there instead of going to
 * the message box. A button or a link does not, as in Slack: typing after a click on a chat writes in it.
 */
const TYPING_OWNERS = `${KEY_OWNERS}, [role='listbox'], [role='grid'], [role='tree'], [role='slider'], [role='radiogroup'], [role='tablist'], [role='combobox'], [role='application'], iframe, webview`;

function closestElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * A key that types a character, with no modifier that makes it a command. Space stays with the
 * focused button, which it presses.
 */
function typesCharacter(event: KeyboardEvent): boolean {
  return event.key?.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Listens on the window for the app's shortcut keys. Returns the removal. */
export function installShortcutKeys(target: Window, platform: () => ShortcutPlatform | undefined): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const system = platform();
    if (!system || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const element = closestElement(event.target);
    const owner = element?.closest(KEY_OWNERS) ?? null;
    // The sheet is a dialog, but its own key closes it.
    const inSheet = owner?.classList.contains("shortcut-sheet") === true;
    const editable = isEditableTarget(event.target);
    const command = matchShortcut(OWNED_KEYS, event, system, editable);
    if (command) {
      if (owner && !(inSheet && command === "shortcuts")) return;
      if (!runShortcutCommand(command)) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editable || event.repeat || !typesCharacter(event) || element?.closest(TYPING_OWNERS)) return;
    // The handler moves the focus during this keydown, so the character lands in the message box.
    runShortcutCommand("typeToComposer");
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
