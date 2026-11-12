/**
 * The items of the More menu of the sidebar pill: every page as a plain row, Marketplace, then Help,
 * Settings and Customize pill. Customize pill is the one place that pins a page to the pill.
 */

import {
  Check,
  ChevronRight,
  CircleQuestionMark,
  DropdownMenu,
  Settings,
  SlidersHorizontal,
  Store,
  type Waypoints,
} from "@openbot/ui";
import { Dynamic } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { shortcutText } from "../shortcuts/shortcut-registry";
import { HelpMenuItems } from "../updates/HelpMenu";
import type { SidebarPages, SidebarPinnablePage } from "./sidebar-pages";

/** A page that the user can pin to the pill. */
export interface PillPage {
  id: SidebarPinnablePage;
  label: string;
  icon: typeof Waypoints;
  open: (button: HTMLElement) => void;
}

export function SidebarMoreMenuItems(props: {
  pages: SidebarPages;
  list: readonly PillPage[];
  /** Runs a page action with the More button as its anchor, after the menu closes. */
  open: (action: (button: HTMLElement) => void) => () => void;
  /** False where there is no pill to pin a page to, such as the top row of a phone. */
  customize: boolean;
}) {
  const { t } = useText();
  const pinned = (page: SidebarPinnablePage) => props.pages.pinned.includes(page);
  return (
    <>
      <For each={props.list} keyed={(page) => page.id}>
        {(page) => (
          <DropdownMenu.Item onSelectAfterClose={props.open(page().open)}>
            <Dynamic component={page().icon} class="agent-context-icon size-4" aria-hidden="true" />
            <span>{page().label}</span>
          </DropdownMenu.Item>
        )}
      </For>
      <Show when={props.pages.onMarketplace}>
        {(onMarketplace) => (
          <DropdownMenu.Item onSelectAfterClose={() => onMarketplace()()}>
            <Store class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.rail.marketplace")}</span>
          </DropdownMenu.Item>
        )}
      </Show>
      <DropdownMenu.Separator />
      <DropdownMenu.Sub
        onOpenChange={(next: boolean) => {
          if (next) props.pages.help.onOpen?.();
        }}
      >
        <DropdownMenu.SubTrigger>
          <CircleQuestionMark class="agent-context-icon size-4" aria-hidden="true" />
          <span>{t("app.help.label")}</span>
          <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent class="ui-action-menu agent-context-menu help-menu" aria-label={t("app.help.label")}>
            <HelpMenuItems {...props.pages.help} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
      <DropdownMenu.Item onSelectAfterClose={props.open(props.pages.onSettings)}>
        <Settings class="agent-context-icon size-4" aria-hidden="true" />
        <span>{t("app.rail.settings")}</span>
        <Show
          when={props.pages.settingsNotice}
          fallback={
            <Show when={props.pages.settingsShortcut ? props.pages.shortcutPlatform : undefined}>
              {(platform) => <span class="ui-menu-trailing">{shortcutText("settings", platform())}</span>}
            </Show>
          }
        >
          {(notice) => <span class="ui-menu-trailing sidebar-more-notice">{notice()}</span>}
        </Show>
      </DropdownMenu.Item>
      <Show when={props.customize}>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <SlidersHorizontal class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.more.customize")}</span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              class="ui-action-menu agent-context-menu agent-context-submenu"
              aria-label={t("sidebar.more.customize")}
            >
              {/* A pin adds a page button to the pill or takes it off. The menu stays open. */}
              <For each={props.list} keyed={(page) => page.id}>
                {(page) => (
                  <DropdownMenu.CheckboxItem
                    closeOnSelect={false}
                    checked={pinned(page().id)}
                    onChange={(checked: boolean) => props.pages.onPinChange(page().id, checked)}
                    aria-label={t("sidebar.pill.pinPage", { name: page().label })}
                  >
                    <span class="ui-menu-check" data-checked={pinned(page().id) ? "" : undefined} aria-hidden="true">
                      <Show when={pinned(page().id)}>
                        <Check />
                      </Show>
                    </span>
                    <span>{page().label}</span>
                  </DropdownMenu.CheckboxItem>
                )}
              </For>
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      </Show>
    </>
  );
}
