/**
 * The shortcut list that shows while the user holds ⌘ (Ctrl on Windows and Linux) alone. It reads
 * the same list as the shortcut sheet, plus the keys that the list does not own, such as the send key
 * of the message box. It does not take the focus or a click: the release of the key closes it.
 */

import type { AppTextKey } from "@openbot/i18n";
import { type JSX, Portal } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { Keyboard } from "../../icons";
import { useText } from "../../text";
import { ShortcutKeys } from "./ShortcutHint";
import {
  comboKeys,
  type KeyCombo,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutPlatform,
  shortcutKeys,
} from "./shortcut-registry";

/** The groups of the list, plus the app-wide keys that only this view shows, such as Quit. */
export type ShortcutPeekGroup = "general" | ShortcutGroup;

const PEEK_GROUPS: readonly ShortcutPeekGroup[] = ["general", ...SHORTCUT_GROUPS];

const GROUP_LABEL = {
  general: "app.shortcuts.group.general",
  navigation: "app.shortcuts.group.navigation",
  chat: "app.shortcuts.group.chat",
  agents: "app.shortcuts.group.agents",
  view: "app.shortcuts.group.view",
  browser: "app.shortcuts.group.browser",
} as const satisfies Record<ShortcutPeekGroup, AppTextKey>;

/** A key that another part owns, such as the send key, which follows a setting. It shows first in its group. */
export interface ShortcutPeekExtra {
  readonly id: string;
  readonly group: ShortcutPeekGroup;
  readonly label: AppTextKey;
  readonly combos: readonly KeyCombo[];
}

export interface ShortcutPeekProps {
  open: boolean;
  platform: ShortcutPlatform;
  /** Shortcuts this surface does not have, as in the sheet. */
  hidden?: readonly ShortcutId[] | undefined;
  extra?: readonly ShortcutPeekExtra[] | undefined;
}

interface PeekRow {
  id: string;
  group: ShortcutPeekGroup;
  label: AppTextKey;
  chords: string[][];
}

export function ShortcutPeek(props: ShortcutPeekProps): JSX.Element {
  const { t } = useText();

  const groups = createMemo(() => {
    const hidden = new Set(props.hidden ?? []);
    const rows: PeekRow[] = [
      ...(props.extra ?? []).map((extra) => ({
        id: extra.id,
        group: extra.group,
        label: extra.label,
        chords: extra.combos.map((combo) => comboKeys(combo, props.platform)),
      })),
      ...SHORTCUTS.filter((shortcut) => !hidden.has(shortcut.id)).map((shortcut) => ({
        id: shortcut.id,
        group: shortcut.group,
        label: shortcut.label,
        chords: shortcutKeys(shortcut.id, props.platform),
      })),
    ];
    return PEEK_GROUPS.map((group) => ({ group, rows: rows.filter((row) => row.group === group) })).filter(
      (entry) => entry.rows.length > 0,
    );
  });

  return (
    <Portal>
      <div
        class="shortcut-peek-backdrop"
        data-open={props.open ? "" : undefined}
        aria-hidden={props.open ? undefined : "true"}
      >
        <section class="shortcut-peek" role={props.open ? "dialog" : undefined} aria-label={t("app.shortcuts.title")}>
          <header class="shortcut-peek-head">
            <span class="shortcut-sheet-mark" aria-hidden="true">
              <Keyboard />
            </span>
            <h2 class="ui-heading" data-size="md" data-tone="primary">
              {t("app.shortcuts.title")}
            </h2>
          </header>
          <div class="shortcut-peek-body">
            <For each={groups()} keyed={(entry) => entry.group}>
              {(entry) => (
                <section class="shortcut-sheet-group" aria-label={t(GROUP_LABEL[entry().group])}>
                  <h3 class="shortcut-sheet-group-title">{t(GROUP_LABEL[entry().group])}</h3>
                  <ul class="shortcut-sheet-list">
                    <For each={entry().rows} keyed={(row) => row.id}>
                      {(row) => (
                        <li class="shortcut-peek-row">
                          <span class="shortcut-sheet-label">{t(row().label)}</span>
                          <span class="shortcut-sheet-chords">
                            <For each={row().chords}>
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
          <footer class="shortcut-sheet-foot">
            <ShortcutKeys keys={shortcutKeys("shortcuts", props.platform)[0] ?? []} />
            <span>{t("app.shortcuts.footer")}</span>
          </footer>
        </section>
      </div>
    </Portal>
  );
}
