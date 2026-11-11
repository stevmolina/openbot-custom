/**
 * The chat sidebar. It takes the place of the page rail and the sections of the agent list, and it
 * stays on every page of the window.
 *
 * Open, it shows a top row with collapse, Search and New, the chat list, the provider usage and the
 * pill. Collapsed, it is a dock: the same buttons, the faces of the chats, the usage rings and the
 * pill in a column.
 *
 * The chat list is one list by last message: the pinned chats, then each agent and channel, newest
 * first, then the people, the hidden agents and the deleted channels. A chat that waits shows it on
 * the face and in the preview line, so the list has no "Needs you" or "Working" group.
 *
 * Once the layout has folders, the list keeps them: "Needs you" holds the chats that wait, above the
 * folders, so a closed folder cannot hide one. Then each folder in the order of the layout, with its
 * chats newest first and the folders in it after them. The chats in no folder sit where the layout
 * puts the unassigned section, with no heading when nothing is above them.
 */

import { SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
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
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarChatRow } from "./SidebarChatRow";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarHiddenGroup } from "./SidebarHiddenGroup";
import { SidebarPeopleSection } from "./SidebarPeopleSection";
import { SidebarPill } from "./SidebarPill";
import { SidebarPinnedGroup } from "./SidebarPinnedGroup";
import { SidebarSectionDraft } from "./SidebarSectionEditor";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarUsage } from "./SidebarUsage";
import { sidebarSectionResolver } from "./sidebar-agent-order";
import type { SidebarPages } from "./sidebar-pages";
import { sidebarPinnedItemKey } from "./sidebar-pins";
import { sidebarAgentWait, sidebarRecentChats } from "./sidebar-recent-chats";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarChatItem } from "./sidebar-types";

/** A round button of the top row, with its name as a tooltip. */
function RoundButton(props: { label: string; onClick: () => void; children: JSX.Element }) {
  return (
    <MotionTooltip content={props.label}>
      <Button
        variant="ghost"
        type="button"
        class="sidebar-chat-round no-drag"
        aria-label={props.label}
        onClick={() => props.onClick()}
      >
        {props.children}
      </Button>
    </MotionTooltip>
  );
}

/** New: a new agent, or a menu with a new agent and a new channel when the server has channels. */
function NewButton() {
  const { props } = useSidebarScope();
  const { t } = useText();
  return (
    <Show
      when={props.onCreateChannel}
      fallback={
        <Show when={props.createSupported !== false}>
          <RoundButton label={t("sidebar.new.agent")} onClick={props.onCreateAgent}>
            <Plus aria-hidden="true" />
          </RoundButton>
        </Show>
      }
    >
      {(createChannel) => (
        <DropdownMenu.Root placement="bottom-end" gutter={6}>
          <MotionTooltip content={t("sidebar.chat.newMenu")}>
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
function SidebarChatTopbar(topProps: { pages: SidebarPages }) {
  const { props } = useSidebarScope();
  const { t } = useText();
  const label = () => (props.compact ? t("sidebar.topbar.expand") : t("sidebar.chat.collapse"));
  return (
    <div class="window-drag sidebar-chat-top">
      <MotionTooltip content={label()}>
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
      <span class="sidebar-chat-spacer" />
      <UpdateButton />
      <RoundButton label={t("sidebar.chat.search")} onClick={props.onOpenSearch}>
        <Search aria-hidden="true" />
      </RoundButton>
      <NewButton />
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
            <Show when={props.createSupported !== false}>
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

/** Rows of the open list, in the order given. */
function SidebarChatRows(rowsProps: { chats: readonly SidebarChatItem[] }) {
  return (
    <div class="sidebar-chat-rows">
      {/* Keyed by chat, so a new order after a message keeps each row, its focus and its menu. */}
      <For each={rowsProps.chats} keyed={(chat) => `${chat.kind}:${chat.id}`}>
        {(chat) => <SidebarChatRow chat={chat()} look="row" />}
      </For>
    </div>
  );
}

/** The chats that wait, and the other chats by the folder that the layout puts them in. */
interface SidebarChatFolderGroups {
  waiting: SidebarChatItem[];
  bySection: ReadonlyMap<string, SidebarChatItem[]>;
}

/**
 * The open list by folder. The folders, their headings, their menus and their collapse are those of
 * the section list; only the rows are the rows of the chat list.
 */
function SidebarChatFolders(foldersProps: { chats: readonly SidebarChatItem[] }) {
  const { customSectionById, draggingKind, props, sectionParent, waitingChats } = useSidebarScope();
  const { t } = useText();
  /**
   * The agents whose wait is in a side thread only. The set holds still during a drag, as the store's
   * `waitingChats` does, so no row moves between "Needs you" and a folder under the pointer.
   */
  let heldSideWaits: ReadonlySet<string> = new Set();
  const sideWaits = createMemo(() => {
    const next = new Set(
      (props.threadLanes?.threads ?? []).flatMap((entry) =>
        sidebarAgentWait(entry.agentId, undefined, [entry]) ? [entry.agentId] : [],
      ),
    );
    if (!draggingKind()) heldSideWaits = next;
    return heldSideWaits;
  });
  const groups = createMemo<SidebarChatFolderGroups>(() => {
    const sectionOf = sidebarSectionResolver(props.layout);
    const waitingIds = new Set(waitingChats().map((chat) => chat.id));
    const waits = (chat: SidebarChatItem) =>
      waitingIds.has(chat.id) || (chat.kind === "agent" && sideWaits().has(chat.id));
    const waiting: SidebarChatItem[] = [];
    const bySection = new Map<string, SidebarChatItem[]>();
    for (const chat of foldersProps.chats) {
      if (waits(chat)) {
        waiting.push(chat);
        continue;
      }
      const sectionId = sectionOf(chat.id);
      bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), chat]);
    }
    return { waiting, bySection };
  });
  const unassignedCount = () => groups().bySection.get(SIDEBAR_UNASSIGNED_SECTION_ID)?.length ?? 0;
  /** The folders at the top of the list and the chats in no folder, in the order of the layout. */
  const topSectionIds = createMemo(() => {
    const ids = props.layout.order.filter((sectionId) =>
      sectionId === SIDEBAR_UNASSIGNED_SECTION_ID
        ? unassignedCount() > 0
        : customSectionById().has(sectionId) && sectionParent(sectionId) === null,
    );
    // A layout always names the unassigned section, but a chat must not be lost if one does not.
    if (unassignedCount() > 0 && !ids.includes(SIDEBAR_UNASSIGNED_SECTION_ID)) ids.push(SIDEBAR_UNASSIGNED_SECTION_ID);
    return ids;
  });
  /** The chats in no folder have a heading only below something, where they would read as part of it. */
  const unassignedHeaded = () => groups().waiting.length > 0 || topSectionIds()[0] !== SIDEBAR_UNASSIGNED_SECTION_ID;
  return (
    <>
      <Show when={groups().waiting.length > 0}>
        <section
          class="sidebar-chat-group sidebar-chat-folder-group"
          aria-label={t("sidebar.waiting.label", { count: groups().waiting.length })}
        >
          <header>
            <h2 class="sidebar-chat-folder-title">{t("sidebar.waiting.title")}</h2>
          </header>
          <SidebarChatRows chats={groups().waiting} />
        </section>
      </Show>
      <For each={topSectionIds()}>
        {(sectionId) => (
          <SidebarChatFolder
            sectionId={sectionId}
            depth={0}
            groups={groups()}
            headed={sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID || unassignedHeaded()}
          />
        )}
      </For>
      <SidebarSectionDraft parentId={null} />
    </>
  );
}

/** One folder of the open list, or the chats in no folder: its chats, then the folders in it. */
function SidebarChatFolder(folderProps: {
  sectionId: string;
  depth: number;
  groups: SidebarChatFolderGroups;
  headed: boolean;
}) {
  const { customSectionById, dragOffset, sectionChildren, sectionDragClasses, sectionIsCollapsed, sectionLabel } =
    useSidebarScope();
  const { t } = useText();
  const sectionId = () => folderProps.sectionId;
  const custom = () => customSectionById().get(sectionId());
  const chats = () => folderProps.groups.bySection.get(sectionId()) ?? [];
  const children = () => (custom() ? sectionChildren(sectionId()) : []);
  const name = () =>
    sectionId() === SIDEBAR_UNASSIGNED_SECTION_ID ? t("sidebar.section.unassigned") : (custom()?.name ?? "");
  const collapsed = () => folderProps.headed && sectionIsCollapsed(sectionId());
  return (
    <section
      class={[
        "sidebar-chat-group sidebar-section sidebar-chat-folder-group",
        { "sidebar-folder": Boolean(custom()) },
        sectionDragClasses(sectionId()),
      ]}
      style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
      aria-label={custom() ? sectionLabel(sectionId()) : name()}
      data-section-id={sectionId()}
      data-depth={custom() ? String(folderProps.depth) : undefined}
    >
      <Show when={folderProps.headed}>
        <SidebarSectionHeader sectionId={sectionId()} name={name()} depth={folderProps.depth} />
      </Show>
      <div
        class="sidebar-section-collapse"
        data-collapsed={collapsed() ? "" : undefined}
        aria-hidden={collapsed() ? "true" : undefined}
        inert={collapsed() ? true : undefined}
      >
        <div id={`sidebar-section-body-${sectionId()}`} class="sidebar-section-body">
          <SidebarChatRows chats={chats()} />
          <For each={children()}>
            {(childId) => (
              <SidebarChatFolder sectionId={childId} depth={folderProps.depth + 1} groups={folderProps.groups} headed />
            )}
          </For>
          <Show when={custom()}>
            <SidebarSectionDraft parentId={sectionId()} />
          </Show>
        </div>
      </div>
    </section>
  );
}

/** The open list. */
function SidebarChatList() {
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
    setAgentListElement,
    updateSidebarNativeDrag,
    userHiddenAgentList,
  } = useSidebarScope();
  const { t } = useText();
  const recent = useRecentChats();
  return (
    <nav
      ref={setAgentListElement}
      aria-label={t("sidebar.nav.label")}
      class={["agent-list sidebar-chat-list", scrollFades.classes()]}
      data-sidebar-dragging={draggingKind()}
      onDragOver={updateSidebarNativeDrag}
      onDragLeave={handleListDragLeave}
      onDrop={dropSidebarNativeDrag}
      onScroll={scrollFades.measure}
    >
      <div class="agent-list-content">
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
        {/* The draft of a first folder needs the folder view, or it would have nowhere to show. */}
        <Show
          when={props.layout.sections.length > 0 || pending.sectionEditor?.target.kind === "create"}
          fallback={<SidebarChatRows chats={recent()} />}
        >
          <SidebarChatFolders chats={recent()} />
        </Show>
        <SidebarPeopleSection sectionId={SIDEBAR_PEOPLE_SECTION_ID} />
        <SidebarHiddenGroup />
        <Show when={props.showingArchivedChannels}>
          <section class="sidebar-chat-group sidebar-section" aria-label={t("sidebar.deletedChannels.title")}>
            <h2 class="sidebar-section-name">{t("sidebar.deletedChannels.title")}</h2>
            <For each={props.deletedChannels} fallback={<p>{t("sidebar.deletedChannels.empty")}</p>}>
              {(channel) => <SidebarChannelRow channel={channel} />}
            </For>
          </section>
        </Show>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {reorderAnnouncement()}
        </span>
      </div>
      <FreeAreaMenu />
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
      <SidebarChatTopbar pages={chatProps.pages} />
      <SidebarChatList />
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
