/**
 * The pill at the bottom of the chat sidebar: the account switch, Chats, the pinned pages and More.
 * The open sidebar lays it out in a row, the dock in a column.
 *
 * The account switch is the server menu with the logo of the active server in front. More lists every
 * page that the user can pin, then Marketplace, Help and Settings. A row opens its page; the pin at
 * the end of the row adds the page to the pill or takes it off, and the menu stays open.
 */

import {
  Button,
  CalendarClock,
  ChartArea,
  ChevronRight,
  CircleQuestionMark,
  DropdownMenu,
  Ellipsis,
  ListChecks,
  MessageCircle,
  MotionTooltip,
  Pin,
  Settings,
  Store,
  Waypoints,
  Workflow,
} from "@openbot/ui";
import { Dynamic } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { ServerMenu } from "../servers/ServerMenu";
import { ServerMark } from "../servers/ServerRail";
import { HelpMenuItems } from "../updates/HelpMenu";
import type { SidebarPage, SidebarPages, SidebarPinnablePage } from "./sidebar-pages";
import { useSidebarScope } from "./sidebar-scope";

/** A page that the user can pin to the pill. */
interface PillPage {
  id: SidebarPinnablePage;
  label: string;
  icon: typeof Waypoints;
  open: (button: HTMLElement) => void;
}

/** One round pill button, with its name as a tooltip. */
function PillButton(props: {
  label: string;
  current: boolean;
  icon: typeof Waypoints;
  vertical: boolean;
  onClick: (button: HTMLElement) => void;
}) {
  return (
    <MotionTooltip content={props.label} placement={props.vertical ? "right" : "top"}>
      <Button
        variant="ghost"
        type="button"
        class="sidebar-pill-button"
        aria-label={props.label}
        aria-current={props.current ? "page" : undefined}
        onClick={(event) => props.onClick(event.currentTarget)}
      >
        <Dynamic component={props.icon} aria-hidden="true" />
      </Button>
    </MotionTooltip>
  );
}

function PillMore(props: { pages: SidebarPages; list: readonly PillPage[]; vertical: boolean }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
  // A pin adds or removes a pill button, so the trigger moves. The menu keeps the place where it
  // opened, so the row under the pointer stays the same.
  let anchor: DOMRect | undefined;
  const changeOpen = (next: boolean) => {
    anchor = next ? trigger?.getBoundingClientRect() : undefined;
    setOpen(next);
  };
  const pinned = (page: SidebarPinnablePage) => props.pages.pinned.includes(page);
  const inMenu = (page: SidebarPage | null) =>
    page === "marketplace" || page === "settings" || props.list.some((item) => item.id === page && !pinned(item.id));
  const openFromTrigger = (open: (button: HTMLElement) => void) => () => {
    if (trigger) open(trigger);
  };
  return (
    <DropdownMenu.Root
      placement={props.vertical ? "right-end" : "top-end"}
      gutter={8}
      onOpenChange={changeOpen}
      getAnchorRect={(element?: HTMLElement) => anchor ?? element?.getBoundingClientRect()}
    >
      <MotionTooltip content={t("app.rail.more")} suppressed={open()} placement={props.vertical ? "right" : "top"}>
        <DropdownMenu.Trigger
          ref={(element: HTMLElement) => {
            trigger = element;
          }}
          class="sidebar-pill-button"
          aria-label={
            props.pages.settingsNotice
              ? t("sidebar.pill.moreNotice", { notice: props.pages.settingsNotice })
              : t("app.rail.more")
          }
          aria-current={inMenu(props.pages.current) ? "page" : undefined}
        >
          <Ellipsis aria-hidden="true" />
          <Show when={props.pages.settingsNotice}>
            <span class="sidebar-pill-notice" aria-hidden="true" />
          </Show>
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu sidebar-more-menu" aria-label={t("app.rail.more")}>
          <For each={props.list} keyed={(page) => page.id}>
            {(page) => (
              // The pin is its own menu item beside the page, so the keyboard reaches it.
              <div role="none" class="sidebar-more-row" data-pinned={pinned(page().id) ? "" : undefined}>
                <DropdownMenu.Item onSelectAfterClose={openFromTrigger(page().open)}>
                  <Dynamic component={page().icon} class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{page().label}</span>
                </DropdownMenu.Item>
                <DropdownMenu.CheckboxItem
                  class="sidebar-more-pin"
                  closeOnSelect={false}
                  checked={pinned(page().id)}
                  onChange={(checked: boolean) => props.pages.onPinChange(page().id, checked)}
                  aria-label={t("sidebar.pill.pinPage", { name: page().label })}
                >
                  <Pin class="agent-context-icon size-4" aria-hidden="true" />
                </DropdownMenu.CheckboxItem>
              </div>
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
              <DropdownMenu.SubContent
                class="ui-action-menu agent-context-menu help-menu"
                aria-label={t("app.help.label")}
              >
                <HelpMenuItems {...props.pages.help} />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item onSelectAfterClose={openFromTrigger(props.pages.onSettings)}>
            <Settings class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.rail.settings")}</span>
            <Show when={props.pages.settingsNotice}>
              {(notice) => <span class="ui-menu-trailing sidebar-more-notice">{notice()}</span>}
            </Show>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The account switch: the server menu, or a button that opens the server settings where there is no
 * server menu.
 */
function AccountSwitch(props: { vertical: boolean; onOpenAppSettings: (trigger: HTMLElement) => void }) {
  const { props: sidebar } = useSidebarScope();
  const { t } = useText();
  return (
    <Show
      when={sidebar.serverMenu}
      fallback={
        <MotionTooltip content={sidebar.serverName} placement={props.vertical ? "right" : "top"}>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-account-switch"
            aria-label={t("sidebar.topbar.openSettings", { name: sidebar.serverName })}
            disabled={!sidebar.onOpenServerSettings}
            onClick={(event) => sidebar.onOpenServerSettings?.(event.currentTarget)}
          >
            <span class="sidebar-account-stack" aria-hidden="true">
              <span class="sidebar-account-logo sidebar-account-logo-front">
                <ServerMark server={{ id: sidebar.serverName, logoUrl: null }} />
              </span>
            </span>
          </Button>
        </MotionTooltip>
      }
    >
      {(serverMenu) => (
        <ServerMenu
          {...serverMenu()}
          serverName={sidebar.serverName}
          look="stack"
          placement={props.vertical ? "right-end" : "top-start"}
          onOpenAppSettings={props.onOpenAppSettings}
        />
      )}
    </Show>
  );
}

export function SidebarPill(props: { pages: SidebarPages; vertical: boolean }) {
  const { t } = useText();
  /** The pages that this server has, in pill order. */
  const list = createMemo((): PillPage[] => {
    const pages: PillPage[] = [];
    const { onRoutines, onWorkflows, onTasks, onSchedule, onUsage } = props.pages;
    if (onRoutines)
      pages.push({ id: "routines", label: t("sidebar.view.routines"), icon: Workflow, open: () => onRoutines() });
    if (onWorkflows) {
      pages.push({ id: "workflows", label: t("app.rail.workflows"), icon: Waypoints, open: () => onWorkflows() });
    }
    if (onTasks) pages.push({ id: "tasks", label: t("app.rail.tasks"), icon: ListChecks, open: onTasks });
    if (onSchedule)
      pages.push({ id: "schedule", label: t("app.rail.schedule"), icon: CalendarClock, open: onSchedule });
    pages.push({ id: "usage", label: t("app.rail.usage"), icon: ChartArea, open: onUsage });
    return pages;
  });
  return (
    <div class={["sidebar-pill", { "sidebar-pill-vertical": props.vertical }]}>
      <AccountSwitch vertical={props.vertical} onOpenAppSettings={props.pages.onSettings} />
      <nav class="sidebar-pill-pages" aria-label={t("app.rail.label")}>
        <PillButton
          label={t("sidebar.pill.chats")}
          current={props.pages.current === "chats"}
          icon={MessageCircle}
          vertical={props.vertical}
          onClick={() => props.pages.onChats()}
        />
        <For each={list().filter((page) => props.pages.pinned.includes(page.id))} keyed={(page) => page.id}>
          {(page) => (
            <PillButton
              label={page().label}
              current={props.pages.current === page().id}
              icon={page().icon}
              vertical={props.vertical}
              onClick={page().open}
            />
          )}
        </For>
        <PillMore pages={props.pages} list={list()} vertical={props.vertical} />
      </nav>
    </div>
  );
}
