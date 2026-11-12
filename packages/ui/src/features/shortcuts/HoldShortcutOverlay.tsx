import type { AppTextKey } from "@openbot/i18n";
import { Portal } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import type { SendShortcut } from "../conversation/send-shortcut";
import { ShortcutKeys } from "./ShortcutHint";
import {
  comboKeys,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutGroup,
  type ShortcutPlatform,
  shortcutKeys,
} from "./shortcut-registry";

const GROUP_LABEL = {
  navigation: "app.shortcuts.group.navigation",
  chat: "app.shortcuts.group.chat",
  agents: "app.shortcuts.group.agents",
  view: "app.shortcuts.group.view",
  browser: "app.shortcuts.group.browser",
} as const satisfies Record<ShortcutGroup, AppTextKey>;

interface OverlayRow {
  label: AppTextKey;
  chords: readonly (readonly string[])[];
}

/** Native edit accelerators from main-window.ts. They do not belong to app command matching. */
function generalRows(platform: ShortcutPlatform, windows: boolean): OverlayRow[] {
  const chord = (key: string, shift = false, alt = false) => [comboKeys({ key, mod: "primary", shift, alt }, platform)];
  return [
    { label: "menu.undo", chords: chord("z") },
    { label: "menu.redo", chords: windows ? chord("y") : chord("z", true) },
    { label: "menu.cut", chords: chord("x") },
    { label: "menu.copy", chords: chord("c") },
    { label: "menu.paste", chords: chord("v") },
    ...(platform === "mac" ? [{ label: "menu.pasteAndMatchStyle", chords: chord("v", true, true) } as const] : []),
    { label: "menu.selectAll", chords: chord("a") },
    ...(platform === "mac" ? [{ label: "menu.quit", chords: chord("q") } as const] : []),
  ];
}

/** A passive glance at the keys. It has no focus target, backdrop, or pointer handler. */
export function HoldShortcutOverlay(props: {
  open: boolean;
  platform: ShortcutPlatform;
  windows: boolean;
  sendShortcut: SendShortcut;
}) {
  const { t } = useText();
  const groups = createMemo(() => [
    { label: "app.shortcuts.group.general" as const, rows: generalRows(props.platform, props.windows) },
    ...SHORTCUT_GROUPS.map((group) => ({
      label: GROUP_LABEL[group],
      rows: [
        ...(group === "chat"
          ? [
              {
                label: "composer.send.message" as const,
                chords: [
                  comboKeys(
                    { key: "Enter", mod: props.sendShortcut === "enter" ? undefined : "primary" },
                    props.platform,
                  ),
                ],
              },
            ]
          : []),
        ...SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => ({
          label: shortcut.label,
          chords: [
            ...shortcutKeys(shortcut.id, props.platform),
            ...(props.platform === "mac" && (shortcut.id === "browserNextTab" || shortcut.id === "browserPreviousTab")
              ? [
                  comboKeys(
                    { key: shortcut.id === "browserNextTab" ? "ArrowRight" : "ArrowLeft", mod: "primary", alt: true },
                    props.platform,
                  ),
                ]
              : []),
          ],
        })),
        ...(group === "browser"
          ? [
              {
                label: "browser.tab.moveLeft" as const,
                chords: [comboKeys({ key: "PageUp", ctrl: true, shift: true }, props.platform)],
              },
              {
                label: "browser.tab.moveRight" as const,
                chords: [comboKeys({ key: "PageDown", ctrl: true, shift: true }, props.platform)],
              },
            ]
          : []),
      ],
    })),
  ]);

  return (
    <Portal>
      <div
        class="hold-shortcut-overlay"
        data-open={props.open ? "true" : "false"}
        role="status"
        aria-label={t("app.shortcuts.title")}
        aria-hidden={props.open ? "false" : "true"}
      >
        <header class="hold-shortcut-head">
          <h2>{t("app.shortcuts.title")}</h2>
          <span>{t("app.shortcuts.holdRelease", { key: props.platform === "mac" ? "⌘" : "Ctrl" })}</span>
        </header>
        <div class="hold-shortcut-groups">
          <For each={groups()}>
            {(group) => (
              <section class="hold-shortcut-group" aria-label={t(group.label)}>
                <h3>{t(group.label)}</h3>
                <ul>
                  <For each={group.rows}>
                    {(row) => (
                      <li>
                        <span>{t(row.label)}</span>
                        <span class="shortcut-sheet-chords">
                          <span class="sr-only">
                            {row.chords.map((chord) => chord.join(" ")).join(` ${t("app.shortcuts.or")} `)}
                          </span>
                          <For each={row.chords}>
                            {(chord, index) => (
                              <>
                                <Show when={index() > 0}>
                                  <span class="shortcut-sheet-or">{t("app.shortcuts.or")}</span>
                                </Show>
                                <ShortcutKeys keys={chord} />
                              </>
                            )}
                          </For>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </div>
    </Portal>
  );
}
