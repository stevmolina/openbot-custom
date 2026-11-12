/**
 * The chat sidebar. It takes the place of the page rail and the sections of the agent list, and it
 * stays on every page of the window.
 *
 * Open, it shows a top row with collapse, Search and New, the chat list, the provider usage and the
 * pill. Collapsed, it is a dock: the same buttons, the faces of the chats, the usage rings and the
 * pill in a column.
 *
 * The open chat list has two zones (see `SidebarChatDock`): the pinned chats and "Needs you" at the
 * top, and a dock over the pill that opens one group at a time: "Working", each folder, "Settled".
 * The "All machines" view keeps both zones for the chats of every server, with machine chips on top.
 */

import {
  Bot,
  Button,
  CheckCheck,
  CircleFadingArrowUp,
  ContextMenu,
  DropdownMenu,
  FolderPlus,
  Hash,
  MotionTooltip,
  PanelLeft,
  Plus,
  Search,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { ServerMark } from "../servers/ServerRail";
import { ShortcutLabel } from "../shortcuts/ShortcutHint";
import { type ShortcutId, type ShortcutPlatform, shortcutAria, shortcutText } from "../shortcuts/shortcut-registry";
import { SidebarChatDock, SidebarChatNeedsYou, useSidebarChatDockGroups } from "./SidebarChatDock";
import { SidebarChatRow } from "./SidebarChatRow";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarMachineChips, SidebarMachineNotices } from "./SidebarMachineFilter";
import { SidebarPill } from "./SidebarPill";
import { SidebarPinnedGroup } from "./SidebarPinnedGroup";
import { SidebarUsage } from "./SidebarUsage";
import type { SidebarPages } from "./sidebar-pages";
import { sidebarPinnedItemKey } from "./sidebar-pins";
import { sidebarRecentChats } from "./sidebar-recent-chats";
import { useSidebarScope } from "./sidebar-scope";

/** The tooltip of a top row button: its name, and its keys when it has a shortcut. */
function buttonTip(label: string, shortcut: ShortcutId | undefined, platform: ShortcutPlatform | undefined) {
  return shortcut ? <ShortcutLabel label={label} shortcut={shortcut} platform={platform} /> : label;
}

/** A round button of the top row, with its name as a tooltip. */
function RoundButton(props: {
  label: string;
  onClick: () => void;
  children: JSX.Element;
  shortcut?: ShortcutId;
  platform?: ShortcutPlatform | undefined;
}) {
  return (
    <MotionTooltip content={buttonTip(props.label, props.shortcut, props.platform)}>
      <Button
        variant="ghost"
        type="button"
        class="sidebar-chat-round no-drag"
        aria-label={props.label}
        aria-keyshortcuts={props.shortcut && props.platform ? shortcutAria(props.shortcut, props.platform) : undefined}
        onClick={() => props.onClick()}
      >
        {props.children}
      </Button>
    </MotionTooltip>
  );
}

/**
 * New in the "All machines" view: no server is the one in view, so New asks for the server of the
 * new agent. Only a server that answers can take one.
 */
function NewOnServerButton() {
  const { props } = useSidebarScope();
  const { t } = useText();
  const online = () => props.allMachines?.machines.filter((machine) => machine.state === "online") ?? [];
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={6}>
      <MotionTooltip content={t("server.allMachines.newAgentOn")}>
        <DropdownMenu.Trigger class="sidebar-chat-round no-drag" aria-label={t("server.allMachines.newAgentOn")}>
          <Plus aria-hidden="true" />
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu" aria-label={t("server.allMachines.newAgentOn")}>
          <div class="ui-menu-label" aria-hidden="true">
            {t("server.allMachines.newAgentOn")}
          </div>
          <For each={online()} keyed={(machine) => machine.id}>
            {(machine) => (
              <DropdownMenu.Item onSelectAfterClose={() => props.allMachines?.onCreateAgent(machine().id)}>
                <span class="server-menu-mark" aria-hidden="true">
                  <ServerMark server={machine()} />
                </span>
                <span>{machine().name}</span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** New: a new agent, or a menu with a new agent and a new channel when the server has channels. */
function NewButton(newProps: { platform: ShortcutPlatform | undefined }) {
  const { props } = useSidebarScope();
  const { t } = useText();
  return (
    <Show when={!props.allMachines} fallback={<NewOnServerButton />}>
      <Show
        when={props.onCreateChannel}
        fallback={
          <Show when={props.createSupported !== false}>
            <RoundButton
              label={t("sidebar.new.agent")}
              onClick={props.onCreateAgent}
              shortcut="newChat"
              platform={newProps.platform}
            >
              <Plus aria-hidden="true" />
            </RoundButton>
          </Show>
        }
      >
        {(createChannel) => (
          <DropdownMenu.Root placement="bottom-end" gutter={6}>
            <MotionTooltip content={buttonTip(t("sidebar.chat.newMenu"), "newChat", newProps.platform)}>
              <DropdownMenu.Trigger class="sidebar-chat-round no-drag" aria-label={t("sidebar.chat.newMenu")}>
                <Plus aria-hidden="true" />
              </DropdownMenu.Trigger>
            </MotionTooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <Show when={props.createSupported !== false}>
                  <DropdownMenu.Item onSelectAfterClose={props.onCreateAgent}>
                    <Bot aria-hidden="true" />
                    {t("sidebar.new.agent")}
                    <Show when={newProps.platform}>
                      {(platform) => <span class="ui-menu-trailing">{shortcutText("newChat", platform())}</span>}
                    </Show>
                  </DropdownMenu.Item>
                </Show>
                <DropdownMenu.Item onSelectAfterClose={() => createChannel()()}>
                  <Hash aria-hidden="true" />
                  {t("sidebar.new.channel")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </Show>
    </Show>
  );
}

/** The update of the server, when it has one. */
function UpdateButton() {
  const { props } = useSidebarScope();
  const { t } = useText();
  return (
    <Show when={props.serverUpdate}>
      {(update) => {
        const label = () =>
          update().running
            ? t("server.update.dialog.progressTitle", { name: props.serverName })
            : t("server.update.dialog.offerTitle", { name: props.serverName, version: update().version });
        return (
          <RoundButton label={label()} onClick={() => update().onOpen()}>
            <CircleFadingArrowUp aria-hidden="true" />
          </RoundButton>
        );
      }}
    </Show>
  );
}

/** The top row: collapse or expand, then Search and New. It also moves the window. */
function SidebarChatTopbar(topProps: {
  pages: SidebarPages;
  /** The large title of the list, shown small in the top row once the large one scrolled away. */
  title?: string | undefined;
  titleShown?: boolean | undefined;
}) {
  const { props } = useSidebarScope();
  const { t } = useText();
  const label = () => (props.compact ? t("sidebar.topbar.expand") : t("sidebar.chat.collapse"));
  const platform = () => topProps.pages.shortcutPlatform;
  return (
    <div class="window-drag sidebar-chat-top">
      <MotionTooltip content={buttonTip(label(), "toggleSidebar", platform())}>
        <Button
          variant="ghost"
          type="button"
          class="sidebar-chat-toggle no-drag"
          aria-label={label()}
          aria-controls="agent-sidebar"
          aria-expanded={props.compact ? "false" : "true"}
          onClick={() => (props.compact ? props.onExpand() : topProps.pages.onCollapse())}
        >
          <PanelLeft aria-hidden="true" />
        </Button>
      </MotionTooltip>
      <Show when={topProps.title} fallback={<span class="sidebar-chat-spacer" />}>
        {(title) => (
          <span
            class="sidebar-chat-spacer sidebar-chat-bar-title"
            data-shown={topProps.titleShown ? "" : undefined}
            aria-hidden="true"
            dir="auto"
          >
            {title()}
          </span>
        )}
      </Show>
      <UpdateButton />
      <RoundButton
        label={t("sidebar.chat.search")}
        onClick={props.onOpenSearch}
        shortcut="search"
        platform={platform()}
      >
        <Search aria-hidden="true" />
      </RoundButton>
      <NewButton platform={platform()} />
    </div>
  );
}

/** The right-click menu of the free area of the list. */
function FreeAreaMenu() {
  const { layoutMutable, props, startCreateSection } = useSidebarScope();
  const { t } = useText();
  return (
    <Show
      when={
        props.createSupported !== false ||
        props.allMachines ||
        props.onCreateChannel ||
        layoutMutable() ||
        props.onMarkAllRead ||
        props.onToggleArchivedChannels
      }
    >
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger class="sidebar-list-context-trigger" aria-label={t("sidebar.nav.freeArea")} />
        <ContextMenu.Portal>
          <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.nav.actions")}>
            <Show when={props.createSupported !== false && !props.allMachines}>
              <ContextMenu.Item onSelect={() => props.onCreateAgent()}>
                <Bot class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("sidebar.new.agent")}</span>
              </ContextMenu.Item>
            </Show>
            <Show when={props.onCreateChannel}>
              <ContextMenu.Item onSelect={() => props.onCreateChannel?.()}>
                <Hash class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("sidebar.new.channel")}</span>
              </ContextMenu.Item>
            </Show>
            <Show when={layoutMutable()}>
              <ContextMenu.Item onSelectAfterClose={() => startCreateSection()}>
                <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("sidebar.new.section")}</span>
              </ContextMenu.Item>
            </Show>
            <Show when={props.onMarkAllRead}>
              <ContextMenu.Item disabled={!props.hasUnread} onSelect={() => props.onMarkAllRead?.()}>
                <CheckCheck class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("sidebar.markAllRead")}</span>
              </ContextMenu.Item>
            </Show>
            {/* Folders and channels belong to one server, so the view says where to add them. */}
            <Show when={props.allMachines}>
              <ContextMenu.Item disabled>
                <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("server.allMachines.serverScoped")}</span>
              </ContextMenu.Item>
            </Show>
            <Show when={props.onToggleArchivedChannels}>
              <ContextMenu.Item onSelect={() => props.onToggleArchivedChannels?.()}>
                {props.showingArchivedChannels ? t("sidebar.deletedChannels.hide") : t("sidebar.deletedChannels.title")}
              </ContextMenu.Item>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </Show>
  );
}

/**
 * The chats of the list, newest first. The pinned and the hidden chats show in their own groups. The
 * list has no "Unread" group, so the chats that the "unread-group" order takes out of the sections
 * come back here.
 */
function useRecentChats() {
  const { filteredChats, waitingChats, unreadChats, props } = useSidebarScope();
  return createMemo(() =>
    sidebarRecentChats([...waitingChats(), ...unreadChats(), ...filteredChats()], props.threadLanes?.threads),
  );
}

/** The open list: the top zone, which scrolls, and the dock. The drag measures both. */
/**
 * The large title of the list. It reports when it has scrolled out of the list, so the top row shows
 * the name small, as an iOS large title does.
 */
function SidebarLargeTitle(titleProps: { name: string; onHiddenChange: (hidden: boolean) => void }) {
  let element: HTMLHeadingElement | undefined;
  onSettled(() => {
    const title = element;
    if (!title || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) titleProps.onHiddenChange(!entry.isIntersecting);
      },
      { root: title.closest(".sidebar-chat-scroll") },
    );
    observer.observe(title);
    return () => {
      observer.disconnect();
      titleProps.onHiddenChange(false);
    };
  });
  return (
    <h1
      ref={(heading) => {
        element = heading;
      }}
      class="sidebar-chat-large-title"
      dir="auto"
    >
      {titleProps.name}
    </h1>
  );
}

function SidebarChatList(listProps: { onTitleHiddenChange: (hidden: boolean) => void }) {
  const {
    dropSidebarNativeDrag,
    draggingKind,
    handleListDragLeave,
    orderedPeople,
    pending,
    props,
    reorderAnnouncement,
    resolvedPinnedItems,
    scrollFades,
    setDragListElement,
    updateSidebarNativeDrag,
    userHiddenAgentList,
  } = useSidebarScope();
  const { t } = useText();
  const recent = useRecentChats();
  const groups = useSidebarChatDockGroups(recent);
  return (
    <nav
      ref={setDragListElement}
      aria-label={t("sidebar.nav.label")}
      class="agent-list sidebar-chat-list"
      data-sidebar-dragging={draggingKind()}
      onDragOver={updateSidebarNativeDrag}
      onDragLeave={handleListDragLeave}
      onDrop={dropSidebarNativeDrag}
    >
      {/* The chips stay over the list while it scrolls. */}
      <Show when={props.machineChips}>{(chips) => <SidebarMachineChips chips={chips()} />}</Show>
      <div
        ref={(element) => scrollFades.bind(element)}
        class={["sidebar-chat-scroll", scrollFades.classes()]}
        style={{ "--agent-list-stuck-height": `${scrollFades.stuckHeight()}px` }}
        onScroll={scrollFades.measure}
      >
        <div class="agent-list-content">
          <Show when={props.largeTitle}>
            <SidebarLargeTitle name={props.serverName} onHiddenChange={listProps.onTitleHiddenChange} />
          </Show>
          <Show
            when={props.allMachines}
            fallback={
              <>
                <Show
                  when={
                    resolvedPinnedItems().length === 0 &&
                    recent().length === 0 &&
                    userHiddenAgentList().length === 0 &&
                    (props.showPeople === false || orderedPeople().length === 0) &&
                    pending.sectionEditor?.target.kind !== "create"
                  }
                >
                  <SidebarEmptyState />
                </Show>
                <SidebarPinnedGroup />
              </>
            }
          >
            {(view) => <SidebarMachineNotices view={view()} />}
          </Show>
          <SidebarChatNeedsYou chats={groups().waiting} />
        </div>
      </div>
      <SidebarChatDock groups={groups()} />
      {/* The free area sits under the folders, so the folders follow the top zone instead of the bottom. */}
      <FreeAreaMenu />
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement()}
      </span>
    </nav>
  );
}

/** The faces of the dock: the pinned chats, then the others, newest first. */
function SidebarChatDockList() {
  const { props, resolvedPinnedItems } = useSidebarScope();
  const { t } = useText();
  const recent = useRecentChats();
  const pinnedKeys = createMemo(() => new Set(props.pinnedItems.map(sidebarPinnedItemKey)));
  return (
    <nav aria-label={t("sidebar.nav.label")} class="sidebar-chat-dock-list">
      <For each={resolvedPinnedItems()} keyed={(item) => sidebarPinnedItemKey(item.ref)}>
        {(item) => <SidebarChatRow chat={item().chat} look="face" pinned />}
      </For>
      <For
        each={recent().filter((chat) => !pinnedKeys().has(sidebarPinnedItemKey({ kind: chat.kind, id: chat.id })))}
        keyed={(chat) => `${chat.kind}:${chat.id}`}
      >
        {(chat) => <SidebarChatRow chat={chat()} look="face" />}
      </For>
    </nav>
  );
}

export function SidebarChat(chatProps: { pages: SidebarPages }) {
  const { props } = useSidebarScope();
  const [titleHidden, setTitleHidden] = createSignal(false);
  return (
    <Show
      when={!props.compact}
      fallback={
        <>
          <SidebarChatTopbar pages={chatProps.pages} />
          <SidebarChatDockList />
          <div class="sidebar-chat-bottom sidebar-chat-dock-bottom">
            <SidebarUsage
              usageRows={chatProps.pages.usageRows}
              customAgentUsage={chatProps.pages.customAgentUsage}
              layout="column"
              onOpen={chatProps.pages.onUsage}
            />
            <SidebarPill pages={chatProps.pages} vertical />
          </div>
        </>
      }
    >
      <SidebarChatTopbar
        pages={chatProps.pages}
        title={props.largeTitle ? props.serverName : undefined}
        titleShown={titleHidden()}
      />
      <SidebarChatList onTitleHiddenChange={setTitleHidden} />
      <div class="sidebar-chat-footer">{props.footer}</div>
      <div class="sidebar-chat-bottom">
        <SidebarUsage
          usageRows={chatProps.pages.usageRows}
          customAgentUsage={chatProps.pages.customAgentUsage}
          layout="tab"
          onOpen={chatProps.pages.onUsage}
        />
        <SidebarPill pages={chatProps.pages} vertical={false} />
      </div>
    </Show>
  );
}
