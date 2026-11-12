import { focusComposerEditor } from "@openbot/ui/features/conversation/composer-focus";
import { ShortcutSheet } from "@openbot/ui/features/shortcuts/ShortcutSheet";
import type { ShortcutId, ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";
import { sidebarChatStep } from "@openbot/ui/features/sidebar/sidebar-chat-step";
import { createSignal, onSettled } from "solid-js";
import { playActionSound } from "../../action-sounds";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
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
    <ShortcutSheet open={open()} onOpenChange={setOpen} platform={props.platform ?? "mac"} hidden={props.hidden} />
  );
}
