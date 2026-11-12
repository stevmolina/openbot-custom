/**
 * The one list of the app's keyboard shortcuts. Each entry names its keys on macOS and on Windows
 * and Linux, the label the shortcut sheet shows, and whether the keys also work while the focus is
 * in a text field. The handlers that act on a key read its match here, the sheet lists every entry,
 * and a tooltip or a menu shows the same keys, so a key and its hint cannot drift apart.
 *
 * Some entries only describe keys that another part owns: the zoom and stop-all items of the
 * native menu, and the keys of the full browser view (`browser-view-shortcuts.ts`).
 */

import type { AppTextKey } from "@openbot/i18n";

/** The keyboard of the device, never of a remote host. */
export type ShortcutPlatform = "mac" | "pc";

export type ShortcutGroup = "navigation" | "chat" | "agents" | "view" | "browser";

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["navigation", "chat", "agents", "view", "browser"];

/** One key chord. A shortcut can have more than one, such as `⌘/` and `?` for the shortcut sheet. */
export interface KeyCombo {
  /** `KeyboardEvent.key`, compared without case. `digit` is any of 1 to 9. */
  readonly key: string;
  /**
   * `KeyboardEvent.code`, matched instead of `key`. Use it for a key whose character changes with
   * Shift or Option, such as the period: Option+period types "≥" on a Mac.
   */
  readonly code?: string;
  /**
   * ⌘ on macOS and Ctrl elsewhere. `any` takes either key on both systems, as the older Search,
   * Settings and Find keys always did.
   */
  readonly mod?: "primary" | "any";
  /** The Control key itself, ⌃ on a Mac. */
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  /** `any` for a character that some keyboard layouts type with Shift, such as "/" and "?". */
  readonly shift?: boolean | "any";
  /** The key also works while a text field or the message box has the focus. */
  readonly inTextFields?: boolean;
}

export type ShortcutId =
  | "search"
  | "newChat"
  | "previousChat"
  | "nextChat"
  | "previousUnreadChat"
  | "nextUnreadChat"
  | "historyBack"
  | "historyForward"
  | "switchServer"
  | "settings"
  | "focusComposer"
  | "findInChat"
  | "findNext"
  | "findPrevious"
  | "copyLastReply"
  | "copyLastCode"
  | "quoteSelection"
  | "closePanel"
  | "stopAgent"
  | "stopAllAgents"
  | "shortcuts"
  | "toggleSidebar"
  | "zoomIn"
  | "zoomOut"
  | "actualSize"
  | "browserNewTab"
  | "browserReopenTab"
  | "browserCloseTab"
  | "browserAddress"
  | "browserReload"
  | "browserBack"
  | "browserForward"
  | "browserNextTab"
  | "browserPreviousTab"
  | "browserSelectTab";

export interface ShortcutDefinition {
  readonly id: ShortcutId;
  readonly group: ShortcutGroup;
  readonly label: AppTextKey;
  readonly mac: readonly KeyCombo[];
  readonly pc: readonly KeyCombo[];
}

type Combos = readonly KeyCombo[];

const both = (combos: Combos) => ({ mac: combos, pc: combos });

/** The entries in the order the sheet lists them. */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  // Navigation
  {
    id: "search",
    group: "navigation",
    label: "app.shortcuts.search",
    ...both([{ key: "k", mod: "any", inTextFields: true }]),
  },
  {
    id: "newChat",
    group: "navigation",
    label: "app.shortcuts.newChat",
    ...both([{ key: "n", mod: "primary", inTextFields: true }]),
  },
  {
    id: "previousChat",
    group: "navigation",
    label: "app.shortcuts.previousChat",
    ...both([{ key: "ArrowUp", alt: true, inTextFields: true }]),
  },
  {
    id: "nextChat",
    group: "navigation",
    label: "app.shortcuts.nextChat",
    ...both([{ key: "ArrowDown", alt: true, inTextFields: true }]),
  },
  {
    id: "previousUnreadChat",
    group: "navigation",
    label: "app.shortcuts.previousUnreadChat",
    ...both([{ key: "ArrowUp", alt: true, shift: true, inTextFields: true }]),
  },
  {
    id: "nextUnreadChat",
    group: "navigation",
    label: "app.shortcuts.nextUnreadChat",
    ...both([{ key: "ArrowDown", alt: true, shift: true, inTextFields: true }]),
  },
  {
    // As in a browser. Alt+← in a text field moves the caret, so it stays with the field.
    id: "historyBack",
    group: "navigation",
    label: "app.shortcuts.historyBack",
    mac: [{ key: "[", mod: "primary", inTextFields: true }],
    pc: [{ key: "ArrowLeft", alt: true }],
  },
  {
    id: "historyForward",
    group: "navigation",
    label: "app.shortcuts.historyForward",
    mac: [{ key: "]", mod: "primary", inTextFields: true }],
    pc: [{ key: "ArrowRight", alt: true }],
  },
  {
    id: "switchServer",
    group: "navigation",
    label: "app.shortcuts.switchServer",
    ...both([{ key: "digit", mod: "primary", inTextFields: true }]),
  },
  {
    // The native Preferences item fires from a text field too.
    id: "settings",
    group: "navigation",
    label: "app.shortcuts.settings",
    ...both([{ key: ",", mod: "any", inTextFields: true }]),
  },
  // Chat
  {
    id: "focusComposer",
    group: "chat",
    label: "app.shortcuts.focusComposer",
    ...both([{ key: "Escape", shift: true, inTextFields: true }]),
  },
  {
    id: "findInChat",
    group: "chat",
    label: "app.shortcuts.findInChat",
    ...both([{ key: "f", mod: "any", inTextFields: true }]),
  },
  {
    id: "findNext",
    group: "chat",
    label: "app.shortcuts.findNext",
    ...both([{ key: "g", mod: "any", inTextFields: true }]),
  },
  {
    id: "findPrevious",
    group: "chat",
    label: "app.shortcuts.findPrevious",
    ...both([{ key: "g", mod: "any", shift: true, inTextFields: true }]),
  },
  {
    id: "copyLastReply",
    group: "chat",
    label: "app.shortcuts.copyLastReply",
    ...both([{ key: "c", mod: "primary", shift: true }]),
  },
  {
    id: "copyLastCode",
    group: "chat",
    label: "app.shortcuts.copyLastCode",
    ...both([{ key: ";", code: "Semicolon", mod: "primary", shift: true, inTextFields: true }]),
  },
  {
    id: "quoteSelection",
    group: "chat",
    label: "app.shortcuts.quoteSelection",
    ...both([{ key: ".", code: "Period", mod: "primary", shift: true, inTextFields: true }]),
  },
  { id: "closePanel", group: "chat", label: "app.shortcuts.closePanel", ...both([{ key: "Escape" }]) },
  // Agents
  {
    // ⌘⇧. quotes the selected text, so this agent's stop sits next to ⌘. with Option. On a Mac
    // Option+. types "≥", so the Mac key is matched by its place. Elsewhere Ctrl+Alt is also AltGr,
    // which types a character on some layouts: there the key must be the period itself.
    id: "stopAgent",
    group: "agents",
    label: "app.shortcuts.stopAgent",
    mac: [{ key: ".", code: "Period", mod: "primary", alt: true, inTextFields: true }],
    pc: [{ key: ".", mod: "primary", alt: true, inTextFields: true }],
  },
  {
    id: "stopAllAgents",
    group: "agents",
    label: "app.shortcuts.stopAllAgents",
    ...both([{ key: ".", code: "Period", mod: "primary", inTextFields: true }]),
  },
  // View
  {
    id: "shortcuts",
    group: "view",
    label: "app.shortcuts.shortcuts",
    ...both([
      { key: "/", mod: "primary", shift: "any", inTextFields: true },
      { key: "?", shift: "any" },
    ]),
  },
  {
    id: "toggleSidebar",
    group: "view",
    label: "app.shortcuts.toggleSidebar",
    ...both([{ key: "b", mod: "primary", inTextFields: true }]),
  },
  {
    id: "zoomIn",
    group: "view",
    label: "app.shortcuts.zoomIn",
    ...both([{ key: "=", mod: "primary", inTextFields: true }]),
  },
  {
    id: "zoomOut",
    group: "view",
    label: "app.shortcuts.zoomOut",
    ...both([{ key: "-", mod: "primary", inTextFields: true }]),
  },
  {
    id: "actualSize",
    group: "view",
    label: "app.shortcuts.actualSize",
    ...both([{ key: "0", mod: "primary", inTextFields: true }]),
  },
  // Browser: `browserViewCommand` matches these keys in the full browser view.
  {
    id: "browserNewTab",
    group: "browser",
    label: "app.shortcuts.browserNewTab",
    ...both([{ key: "t", mod: "primary" }]),
  },
  {
    id: "browserReopenTab",
    group: "browser",
    label: "app.shortcuts.browserReopenTab",
    ...both([{ key: "t", mod: "primary", shift: true }]),
  },
  {
    id: "browserCloseTab",
    group: "browser",
    label: "app.shortcuts.browserCloseTab",
    ...both([{ key: "w", mod: "primary" }]),
  },
  {
    id: "browserAddress",
    group: "browser",
    label: "app.shortcuts.browserAddress",
    ...both([{ key: "l", mod: "primary" }]),
  },
  {
    id: "browserReload",
    group: "browser",
    label: "app.shortcuts.browserReload",
    ...both([{ key: "r", mod: "primary" }]),
  },
  { id: "browserBack", group: "browser", label: "app.shortcuts.browserBack", ...both([{ key: "[", mod: "primary" }]) },
  {
    id: "browserForward",
    group: "browser",
    label: "app.shortcuts.browserForward",
    ...both([{ key: "]", mod: "primary" }]),
  },
  {
    id: "browserNextTab",
    group: "browser",
    label: "app.shortcuts.browserNextTab",
    ...both([{ key: "Tab", ctrl: true }]),
  },
  {
    id: "browserPreviousTab",
    group: "browser",
    label: "app.shortcuts.browserPreviousTab",
    ...both([{ key: "Tab", ctrl: true, shift: true }]),
  },
  {
    id: "browserSelectTab",
    group: "browser",
    label: "app.shortcuts.browserSelectTab",
    ...both([{ key: "digit", mod: "primary" }]),
  },
];

const BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function shortcutDefinition(id: ShortcutId): ShortcutDefinition {
  const shortcut = BY_ID.get(id);
  if (!shortcut) throw new Error(`Unknown shortcut: ${id}`);
  return shortcut;
}

export function shortcutCombos(id: ShortcutId, platform: ShortcutPlatform): readonly KeyCombo[] {
  const shortcut = shortcutDefinition(id);
  return platform === "mac" ? shortcut.mac : shortcut.pc;
}

/** The fields of a key press that a match reads. A browser autofill sends a keydown with no `key`. */
export interface ShortcutKeyEvent {
  readonly key?: string;
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Whether a key press is exactly this chord: the key and each modifier, no more and no fewer. */
export function comboMatches(combo: KeyCombo, event: ShortcutKeyEvent, platform: ShortcutPlatform): boolean {
  const key = event.key?.toLocaleLowerCase();
  if (combo.code !== undefined) {
    if (event.code !== combo.code) return false;
  } else if (key === undefined) {
    return false;
  } else if (combo.key === "digit") {
    if (!/^[1-9]$/u.test(key)) return false;
  } else if (key !== combo.key.toLocaleLowerCase()) return false;
  if (event.altKey !== Boolean(combo.alt)) return false;
  if (combo.shift !== "any" && event.shiftKey !== Boolean(combo.shift)) return false;
  if (combo.mod === "any") return event.metaKey || event.ctrlKey;
  if (combo.mod === "primary") {
    return platform === "mac"
      ? event.metaKey && event.ctrlKey === Boolean(combo.ctrl)
      : event.ctrlKey && !event.metaKey;
  }
  return !event.metaKey && event.ctrlKey === Boolean(combo.ctrl);
}

/** Whether a key press is one of the chords of a shortcut. `editable` excludes the chords that leave a text field alone. */
export function shortcutMatches(
  id: ShortcutId,
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  editable = false,
): boolean {
  return shortcutCombos(id, platform).some(
    (combo) => (!editable || combo.inTextFields === true) && comboMatches(combo, event, platform),
  );
}

/** The first of `ids` that a key press is, or undefined. */
export function matchShortcut<T extends ShortcutId>(
  ids: readonly T[],
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  editable = false,
): T | undefined {
  return ids.find((id) => shortcutMatches(id, event, platform, editable));
}

const MAC_KEY_NAMES: Readonly<Record<string, string>> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "↩",
  tab: "⇥",
  digit: "1–9",
};

const PC_KEY_NAMES: Readonly<Record<string, string>> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  digit: "1–9",
};

function keyName(key: string, platform: ShortcutPlatform): string {
  const lower = key.toLocaleLowerCase();
  return (
    (platform === "mac" ? MAC_KEY_NAMES : PC_KEY_NAMES)[lower] ?? (key.length === 1 ? key.toLocaleUpperCase() : key)
  );
}

/**
 * The keys of a chord, one cap each, in the order the system writes them: `⌃ ⌥ ⇧ ⌘ K` on a Mac
 * and `Ctrl Alt Shift K` elsewhere.
 */
export function comboKeys(combo: KeyCombo, platform: ShortcutPlatform): string[] {
  const keys: string[] = [];
  const mac = platform === "mac";
  const control = combo.ctrl === true || (!mac && combo.mod !== undefined);
  if (control) keys.push(mac ? "⌃" : "Ctrl");
  if (combo.alt) keys.push(mac ? "⌥" : "Alt");
  if (combo.shift === true) keys.push(mac ? "⇧" : "Shift");
  if (mac && combo.mod !== undefined) keys.push("⌘");
  keys.push(keyName(combo.key, platform));
  return keys;
}

/** The chords of a shortcut as key caps: one list per chord. */
export function shortcutKeys(id: ShortcutId, platform: ShortcutPlatform): string[][] {
  return shortcutCombos(id, platform).map((combo) => comboKeys(combo, platform));
}

/** The first chord as one short text, as a tooltip or a menu shows it: `⇧⌘C` on a Mac, `Ctrl+Shift+C` elsewhere. */
export function shortcutText(id: ShortcutId, platform: ShortcutPlatform): string {
  const [first] = shortcutKeys(id, platform);
  if (!first) return "";
  return platform === "mac" ? first.join("") : first.join("+");
}

const ARIA_KEY_NAMES: Readonly<Record<string, string>> = { escape: "Escape", digit: "1" };

/** The `aria-keyshortcuts` value of the first chord. */
export function shortcutAria(id: ShortcutId, platform: ShortcutPlatform): string {
  const [combo] = shortcutCombos(id, platform);
  if (!combo) return "";
  const parts: string[] = [];
  if (combo.ctrl === true || (platform === "pc" && combo.mod !== undefined)) parts.push("Control");
  if (combo.alt) parts.push("Alt");
  if (combo.shift === true) parts.push("Shift");
  if (platform === "mac" && combo.mod !== undefined) parts.push("Meta");
  const key = combo.key.toLocaleLowerCase();
  parts.push(ARIA_KEY_NAMES[key] ?? (combo.key.length === 1 ? combo.key.toLocaleUpperCase() : combo.key));
  return parts.join("+");
}

/** Whether keys typed here belong to the element: a text field, an editable area or a select. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
  );
}
