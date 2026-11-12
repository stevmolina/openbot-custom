/**
 * The list of every keyboard shortcut, by group, with a filter. `⌘/` opens it, and `?` too when the
 * focus is not in a text field. The keys come from `shortcut-registry.ts`, so the list cannot show a
 * key the app does not have.
 */

import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { IconButton } from "../../button";
import { Dialog } from "../../complex";
import { Input } from "../../form";
import { Keyboard, Search, X } from "../../icons";
import { useText } from "../../text";
import { ShortcutKeys } from "./ShortcutHint";
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutDefinition,
  type ShortcutGroup,
  type ShortcutId,
  type ShortcutPlatform,
  shortcutKeys,
  shortcutText,
} from "./shortcut-registry";

const GROUP_LABEL = {
  navigation: "app.shortcuts.group.navigation",
  chat: "app.shortcuts.group.chat",
  agents: "app.shortcuts.group.agents",
  view: "app.shortcuts.group.view",
  browser: "app.shortcuts.group.browser",
} as const satisfies Record<ShortcutGroup, AppTextKey>;

export interface ShortcutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: ShortcutPlatform;
  /** Shortcuts this surface does not have, such as the native menu keys in the web client. */
  hidden?: readonly ShortcutId[] | undefined;
}

interface SheetRow {
  shortcut: ShortcutDefinition;
  label: string;
  chords: string[][];
}

export function ShortcutSheet(props: ShortcutSheetProps): JSX.Element {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  let input: HTMLInputElement | undefined;

  const rows = createMemo((): SheetRow[] => {
    const hidden = new Set(props.hidden ?? []);
    return SHORTCUTS.filter((shortcut) => !hidden.has(shortcut.id)).map((shortcut) => ({
      shortcut,
      label: t(shortcut.label),
      chords: shortcutKeys(shortcut.id, props.platform),
    }));
  });

  /** A row matches its name, its group, or its keys as a menu writes them, such as "⌘K" or "ctrl+k". */
  const groups = createMemo(() => {
    const words = query().trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const shown = rows().filter((row) => {
      if (words.length === 0) return true;
      const haystack = [
        row.label,
        t(GROUP_LABEL[row.shortcut.group]),
        shortcutText(row.shortcut.id, props.platform),
        ...row.chords.map((chord) => chord.join(" ")),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    return SHORTCUT_GROUPS.map((group) => ({
      group,
      rows: shown.filter((row) => row.shortcut.group === group),
    })).filter((entry) => entry.rows.length > 0);
  });

  const close = () => props.onOpenChange(false);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setQuery("");
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="shortcut-sheet-overlay" />
        <Dialog.Content
          class="shortcut-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            if (!input) return;
            event.preventDefault();
            input.focus({ preventScroll: true });
          }}
        >
          <header class="shortcut-sheet-head">
            <span class="shortcut-sheet-mark" aria-hidden="true">
              <Keyboard />
            </span>
            <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
              {t("app.shortcuts.title")}
            </Dialog.Title>
            <IconButton label={t("common.close")} variant="ghost" data-cuelume-tap="close" onClick={close}>
              <X />
            </IconButton>
          </header>
          <label class="shortcut-sheet-filter">
            <Search aria-hidden="true" />
            <Input
              ref={(element: HTMLInputElement) => {
                input = element;
              }}
              type="search"
              class="shortcut-sheet-input"
              aria-label={t("app.shortcuts.filter")}
              placeholder={t("app.shortcuts.filter")}
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div class="shortcut-sheet-body">
            <Show
              when={groups().length > 0}
              fallback={<p class="shortcut-sheet-empty">{t("app.shortcuts.empty", { query: query().trim() })}</p>}
            >
              <For each={groups()} keyed={(entry) => entry.group}>
                {(entry) => (
                  <section class="shortcut-sheet-group" aria-label={t(GROUP_LABEL[entry().group])}>
                    <h3 class="shortcut-sheet-group-title">{t(GROUP_LABEL[entry().group])}</h3>
                    <ul class="shortcut-sheet-list">
                      <For each={entry().rows} keyed={(row) => row.shortcut.id}>
                        {(row) => (
                          <li class="shortcut-sheet-row">
                            <span class="shortcut-sheet-label">{row().label}</span>
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
            </Show>
          </div>
          <footer class="shortcut-sheet-foot">
            <ShortcutKeys keys={shortcutKeys("shortcuts", props.platform)[0] ?? []} />
            <span>{t("app.shortcuts.footer")}</span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
