import { focusComposerEditor } from "@openbot/ui/features/conversation/composer-focus";
import { ShortcutPeek, type ShortcutPeekExtra } from "@openbot/ui/features/shortcuts/ShortcutPeek";
import { ShortcutSheet } from "@openbot/ui/features/shortcuts/ShortcutSheet";
import type { ShortcutId, ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";
import { sidebarChatStep } from "@openbot/ui/features/sidebar/sidebar-chat-step";
import { createMemo, createSignal, onSettled } from "solid-js";
import { playActionSound } from "../../action-sounds";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { useSendShortcutMode } from "../../send-shortcut-preference";
import { watchModifierHold } from "./modifier-hold";
import { installShortcutKeys, onShortcutCommand, runMenuCommand } from "./shortcut-commands";

/**
 * The shortcut keys of one window and the sheet that lists them. Mount it once per window, beside
 * the other overlays. On desktop it also runs the commands of the native menu items.
 */
export function AppShortcuts(props: {
  /** Undefined until the platform is known: no key works before then. */
  platform: ShortcutPlatform | undefined;
  /** Shortcuts this surface does not have, left out of the sheet. */
  hidden?: readonly ShortcutId[];
  /** Whether main sends the commands of its menu items: only in the desktop app. */
  nativeMenu: boolean;
}) {
  const layout = useLayout();
  const [open, setOpen] = createSignal(false);
  /** The list that shows while the primary key is held alone. */
  const [peek, setPeek] = createSignal(false);
  const sendMode = useSendShortcutMode();
  /** The keys that the shortcut list does not own: the send key follows its setting. */
  const peekExtra = createMemo((): ShortcutPeekExtra[] => {
    const sendWithMod = sendMode() === "mod-enter";
    const extra: ShortcutPeekExtra[] = [
      {
        id: "sendMessage",
        group: "chat",
        label: "app.shortcuts.sendMessage",
        combos: [sendWithMod ? { key: "Enter", mod: "primary" } : { key: "Enter" }],
      },
      {
        id: "newLine",
        group: "chat",
        label: "app.shortcuts.newLine",
        combos: sendWithMod ? [{ key: "Enter" }, { key: "Enter", shift: true }] : [{ key: "Enter", shift: true }],
      },
    ];
    // The Mac menu owns ⌘Q. The Windows and Linux menus quit with the system's own keys.
    if (props.nativeMenu && props.platform === "mac") {
      extra.unshift({ id: "quit", group: "general", label: "menu.quit", combos: [{ key: "q", mod: "primary" }] });
    }
    return extra;
  });
  /** Opens the next chat of the sidebar the way a click on its row does. */
  const stepChat = (offset: 1 | -1, unread: boolean) => {
    const row = sidebarChatStep(document, offset, unread);
    if (!row) return false;
    row.scrollIntoView({ block: "nearest" });
    // A click on a row plays its own cue. This key press clicks nothing.
    playActionSound("navigate");
    row.click();
    return true;
  };
  onSettled(() => {
    const removals = [
      installShortcutKeys(window, () => props.platform),
      watchModifierHold(
        window,
        () => props.platform,
        // The sheet already lists every key.
        (held) => setPeek(held && !open()),
      ),
      onShortcutCommand("shortcuts", () => {
        setOpen((current) => !current);
        return true;
      }),
      onShortcutCommand("toggleSidebar", () => {
        if (layout.leftPanelCompact()) layout.expandSidebar();
        else layout.setSidebarCollapsed(true);
        return true;
      }),
      onShortcutCommand("previousChat", () => stepChat(-1, false)),
      onShortcutCommand("nextChat", () => stepChat(1, false)),
      onShortcutCommand("previousUnreadChat", () => stepChat(-1, true)),
      onShortcutCommand("nextUnreadChat", () => stepChat(1, true)),
      onShortcutCommand("focusComposer", () => focusComposerEditor(document)),
      onShortcutCommand("typeToComposer", () => focusComposerEditor(document)),
    ];
    if (props.nativeMenu) removals.push(appPort().onRunShortcut(runMenuCommand));
    return () => {
      for (const remove of removals) remove();
    };
  });
  return (
    <>
      <ShortcutSheet open={open()} onOpenChange={setOpen} platform={props.platform ?? "mac"} hidden={props.hidden} />
      <ShortcutPeek open={peek()} platform={props.platform ?? "mac"} hidden={props.hidden} extra={peekExtra()} />
    </>
  );
}
