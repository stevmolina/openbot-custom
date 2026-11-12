/**
 * The open chat list in two zones.
 *
 * The top zone scrolls and takes the free space: "Needs you" holds the chats that wait for the user,
 * an agent whose wait is only in a side thread too. The dock sits at the bottom of the list, over the
 * pill, and holds groups that each open and close by itself: "Working", each folder at the top of the layout in the layout
 * order, then "Settled", the chats in no folder. Each chat is in one group: a chat that waits is in
 * "Needs you", one that works (or a channel with a running task) is in "Working", and the others are in their folder or in "Settled".
 * People, the hidden agents and the deleted channels follow the chats of "Settled".
 *
 * The open groups are saved with the collapsed sections (`dockOpenGroups` in the scope), so they stay
 * open after a restart. A folder group keeps the menu, the drag and the drop of its section.
 */

import { SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarChatRow } from "./SidebarChatRow";
import { SidebarDockHeadContent } from "./SidebarDockHead";
import { SidebarHiddenGroup } from "./SidebarHiddenGroup";
import { SidebarPeopleSection } from "./SidebarPeopleSection";
import { SidebarSectionDraft } from "./SidebarSectionEditor";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { sidebarSectionResolver } from "./sidebar-agent-order";
import { sidebarAgentWait } from "./sidebar-recent-chats";
import { useSidebarScope } from "./sidebar-scope";
import { SIDEBAR_DOCK_WORKING_ID, type SidebarChatItem } from "./sidebar-types";

/** Rows of the open list, in the order given. */
export function SidebarChatRows(rowsProps: { chats: readonly SidebarChatItem[] }) {
  return (
    <div class="sidebar-chat-rows">
      {/* Keyed by chat, so a new order after a message keeps each row, its focus and its menu. */}
      <For each={rowsProps.chats} keyed={(chat) => `${chat.kind}:${chat.id}`}>
        {(chat) => <SidebarChatRow chat={chat()} look="row" />}
      </For>
    </div>
  );
}

/** The chats that wait, the chats that work, and the other chats by the folder that the layout puts them in. */
interface SidebarChatDockGroups {
  waiting: SidebarChatItem[];
  working: SidebarChatItem[];
  bySection: ReadonlyMap<string, SidebarChatItem[]>;
}

/**
 * The agents whose wait is only in a side thread, and the agents with a running side thread. Each set
 * holds still during a drag, as the store's `waitingChats` does, so no row moves between groups under
 * the pointer.
 */
function useThreadStates() {
  const { draggingKind, props } = useSidebarScope();
  let held = { waits: new Set<string>(), works: new Set<string>() };
  return createMemo(() => {
    const threads = props.threadLanes?.threads ?? [];
    const next = {
      waits: new Set(
        threads.flatMap((entry) => (sidebarAgentWait(entry.agentId, undefined, [entry]) ? [entry.agentId] : [])),
      ),
      works: new Set(threads.flatMap((entry) => (entry.state.kind === "working" ? [entry.agentId] : []))),
    };
    if (!draggingKind()) held = next;
    return held;
  });
}

/** The groups of the list. `chats` is newest first, and each group keeps that order. */
export function useSidebarChatDockGroups(chats: () => readonly SidebarChatItem[]) {
  const { draggingKind, props, waitingChats } = useSidebarScope();
  const threadStates = useThreadStates();
  let heldWorking = new Set<string>();
  /** The agents that work and the channels with a running task, as `kind:id` keys. */
  const workingIds = createMemo(() => {
    const next = new Set([
      ...Object.keys(props.agentStates).flatMap((agentId) =>
        props.agentStates[agentId]?.kind === "working" ? [`agent:${agentId}`] : [],
      ),
      ...(props.channels ?? []).flatMap((channel) => (channel.activeTasks > 0 ? [`channel:${channel.id}`] : [])),
    ]);
    if (!draggingKind()) heldWorking = next;
    return heldWorking;
  });
  return createMemo<SidebarChatDockGroups>(() => {
    const sectionOf = sidebarSectionResolver(props.layout);
    const waitingIds = new Set(waitingChats().map((chat) => chat.id));
    const states = threadStates();
    const waiting: SidebarChatItem[] = [];
    const working: SidebarChatItem[] = [];
    const bySection = new Map<string, SidebarChatItem[]>();
    for (const chat of chats()) {
      const agent = chat.kind === "agent";
      if (waitingIds.has(chat.id) || (agent && states.waits.has(chat.id))) {
        waiting.push(chat);
      } else if (workingIds().has(`${chat.kind}:${chat.id}`) || (agent && states.works.has(chat.id))) {
        working.push(chat);
      } else {
        const sectionId = sectionOf(chat.id);
        bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), chat]);
      }
    }
    return { waiting, working, bySection };
  });
}

/** "Needs you", at the top of the list. It hides while no chat waits. */
export function SidebarChatNeedsYou(needsProps: { chats: readonly SidebarChatItem[] }) {
  const { t, format } = useText();
  return (
    <Show when={needsProps.chats.length > 0}>
      <section
        class="sidebar-chat-group sidebar-chat-folder-group sidebar-needs-you"
        aria-label={t("sidebar.waiting.label", { count: needsProps.chats.length })}
      >
        <header class="sidebar-needs-you-head">
          <h2 class="sidebar-chat-folder-title">{t("sidebar.waiting.title")}</h2>
          <span class="sidebar-needs-you-count" aria-hidden="true">
            {format.number(needsProps.chats.length)}
          </span>
        </header>
        <SidebarChatRows chats={needsProps.chats} />
      </section>
    </Show>
  );
}

/** Whether a chat has a reply that the user did not read. */
function useChatUnread() {
  const { props } = useSidebarScope();
  return (chat: SidebarChatItem) =>
    chat.kind === "agent"
      ? props.agentStates[chat.id]?.kind === "unread" || (props.threadLanes?.unreadAgentIds.has(chat.id) ?? false)
      : chat.channel.unreadCount > 0;
}

/** The body of a dock group. It is in the DOM while closed, so it opens and closes with the section motion. */
function SidebarDockBody(bodyProps: { id: string; open: boolean; children: JSX.Element }) {
  return (
    <div
      class="sidebar-section-collapse"
      data-collapsed={bodyProps.open ? undefined : ""}
      aria-hidden={bodyProps.open ? undefined : "true"}
      inert={bodyProps.open ? undefined : true}
    >
      <div id={`sidebar-section-body-${bodyProps.id}`} class="sidebar-section-body">
        <div class="sidebar-dock-body">{bodyProps.children}</div>
      </div>
    </div>
  );
}

/** "Working" and "Settled": a group with a plain heading. "Settled" is the unassigned section, so a chat dropped on it leaves its folder. */
function SidebarDockGroup(groupProps: {
  id: string;
  name: string;
  chats: readonly SidebarChatItem[];
  open: boolean;
  onToggle: () => void;
  children?: JSX.Element;
}) {
  const { dragOffset, sectionDragClasses } = useSidebarScope();
  const unread = useChatUnread();
  const open = () => groupProps.open;
  const section = () => groupProps.id === SIDEBAR_UNASSIGNED_SECTION_ID;
  return (
    <section
      class={[
        "sidebar-dock-group",
        { "sidebar-section": section() },
        section() ? sectionDragClasses(groupProps.id) : "",
      ]}
      style={section() ? `--sidebar-drag-y: ${dragOffset(groupProps.id).y}px;` : undefined}
      aria-label={groupProps.name}
      data-section-id={section() ? groupProps.id : undefined}
    >
      <header>
        <Button
          variant="ghost"
          type="button"
          class="sidebar-section-toggle sidebar-dock-head"
          aria-expanded={open() ? "true" : "false"}
          aria-controls={`sidebar-section-body-${groupProps.id}`}
          data-cuelume-open={open() ? undefined : ""}
          data-cuelume-close={open() ? "" : undefined}
          data-cuelume-emphasis="subtle"
          onClick={() => groupProps.onToggle()}
        >
          <SidebarDockHeadContent
            name={groupProps.name}
            count={groupProps.chats.length}
            open={open()}
            unread={groupProps.chats.some(unread)}
          />
        </Button>
      </header>
      <SidebarDockBody id={groupProps.id} open={open()}>
        <SidebarChatRows chats={groupProps.chats} />
        {groupProps.children}
      </SidebarDockBody>
    </section>
  );
}

/** The chats of a folder and of the folders in it, for the count and the unread dot of its heading. */
function folderChatsDeep(
  sectionId: string,
  groups: SidebarChatDockGroups,
  children: (sectionId: string) => string[],
): SidebarChatItem[] {
  return [
    ...(groups.bySection.get(sectionId) ?? []),
    ...children(sectionId).flatMap((childId) => folderChatsDeep(childId, groups, children)),
  ];
}

/** A folder at the top of the layout, as a dock group. The folders in it show inside, as in the list. */
function SidebarDockFolder(folderProps: {
  sectionId: string;
  groups: SidebarChatDockGroups;
  open: boolean;
  onToggle: () => void;
}) {
  const { customSectionById, dragOffset, sectionChildren, sectionDragClasses, sectionLabel } = useSidebarScope();
  const unread = useChatUnread();
  const sectionId = () => folderProps.sectionId;
  const deep = createMemo(() => folderChatsDeep(sectionId(), folderProps.groups, sectionChildren));
  const open = () => folderProps.open;
  return (
    <section
      class={["sidebar-dock-group sidebar-section", sectionDragClasses(sectionId())]}
      style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
      aria-label={sectionLabel(sectionId())}
      data-section-id={sectionId()}
      data-depth="0"
    >
      <SidebarSectionHeader
        sectionId={sectionId()}
        name={customSectionById().get(sectionId())?.name ?? ""}
        dock={{ count: deep().length, unread: deep().some(unread), open: open(), onToggle: folderProps.onToggle }}
      />
      <SidebarDockBody id={sectionId()} open={open()}>
        <SidebarChatRows chats={folderProps.groups.bySection.get(sectionId()) ?? []} />
        <For each={sectionChildren(sectionId())}>
          {(childId) => <SidebarChatFolder sectionId={childId} depth={1} groups={folderProps.groups} />}
        </For>
        <SidebarSectionDraft parentId={sectionId()} />
      </SidebarDockBody>
    </section>
  );
}

/** A folder in a dock folder: its chats, then the folders in it, with the heading and collapse of the section list. */
function SidebarChatFolder(folderProps: { sectionId: string; depth: number; groups: SidebarChatDockGroups }) {
  const { customSectionById, dragOffset, sectionChildren, sectionDragClasses, sectionIsCollapsed, sectionLabel } =
    useSidebarScope();
  const sectionId = () => folderProps.sectionId;
  const collapsed = () => sectionIsCollapsed(sectionId());
  return (
    <section
      class={[
        "sidebar-chat-group sidebar-section sidebar-chat-folder-group sidebar-folder",
        sectionDragClasses(sectionId()),
      ]}
      style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
      aria-label={sectionLabel(sectionId())}
      data-section-id={sectionId()}
      data-depth={String(folderProps.depth)}
    >
      <SidebarSectionHeader
        sectionId={sectionId()}
        name={customSectionById().get(sectionId())?.name ?? ""}
        depth={folderProps.depth}
      />
      <div
        class="sidebar-section-collapse"
        data-collapsed={collapsed() ? "" : undefined}
        aria-hidden={collapsed() ? "true" : undefined}
        inert={collapsed() ? true : undefined}
      >
        <div id={`sidebar-section-body-${sectionId()}`} class="sidebar-section-body">
          <SidebarChatRows chats={folderProps.groups.bySection.get(sectionId()) ?? []} />
          <For each={sectionChildren(sectionId())}>
            {(childId) => (
              <SidebarChatFolder sectionId={childId} depth={folderProps.depth + 1} groups={folderProps.groups} />
            )}
          </For>
          <SidebarSectionDraft parentId={sectionId()} />
        </div>
      </div>
    </section>
  );
}

/** The dock at the bottom of the list. It hides while it has no group. */
export function SidebarChatDock(dockProps: { groups: SidebarChatDockGroups }) {
  const {
    customSectionById,
    dockOpenGroups,
    orderedPeople,
    pending,
    props,
    sectionParent,
    setDockOpenGroups,
    userHiddenAgentList,
  } = useSidebarScope();
  const { t } = useText();
  /** The folders at the top of the layout, in its order. */
  const folderIds = createMemo(() =>
    props.layout.order.filter((sectionId) => customSectionById().has(sectionId) && sectionParent(sectionId) === null),
  );
  /** The chats in no folder. A chat whose folder is not in the layout any more counts as in none. */
  const settled = createMemo(() => [
    ...(dockProps.groups.bySection.get(SIDEBAR_UNASSIGNED_SECTION_ID) ?? []),
    ...[...dockProps.groups.bySection].flatMap(([sectionId, chats]) =>
      sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID && !customSectionById().has(sectionId) ? chats : [],
    ),
  ]);
  const people = () => props.showPeople !== false && orderedPeople().length > 0;
  const settledShown = () =>
    settled().length > 0 || people() || userHiddenAgentList().length > 0 || props.showingArchivedChannels === true;
  /** The groups on screen, in their order. */
  const shownIds = createMemo(() => [
    ...(dockProps.groups.working.length > 0 ? [SIDEBAR_DOCK_WORKING_ID] : []),
    ...folderIds(),
    ...(settledShown() ? [SIDEBAR_UNASSIGNED_SECTION_ID] : []),
  ]);
  /**
   * The open groups on screen. When the user left groups open but none of them is on screen, such as
   * "Working" while no chat works, the dock opens "Settled", or else its first group.
   */
  const openIds = createMemo<readonly string[]>(() => {
    const saved = dockOpenGroups();
    const shown = saved.filter((id) => shownIds().includes(id));
    if (saved.length === 0 || shown.length > 0) return shown;
    const fallback = shownIds().includes(SIDEBAR_UNASSIGNED_SECTION_ID) ? SIDEBAR_UNASSIGNED_SECTION_ID : shownIds()[0];
    return fallback === undefined ? [] : [fallback];
  });
  const isOpen = (groupId: string) => openIds().includes(groupId);
  /** A click opens or closes one group. The other groups keep their state. */
  const toggle = (groupId: string) =>
    setDockOpenGroups(isOpen(groupId) ? openIds().filter((id) => id !== groupId) : [...openIds(), groupId]);
  const draftShown = () => {
    const target = pending.sectionEditor?.target;
    return target?.kind === "create" && (target.parentId ?? null) === null;
  };
  return (
    <Show when={dockProps.groups.working.length > 0 || folderIds().length > 0 || settledShown() || draftShown()}>
      <div class="sidebar-dock">
        <Show when={dockProps.groups.working.length > 0}>
          <SidebarDockGroup
            id={SIDEBAR_DOCK_WORKING_ID}
            name={t("sidebar.lanes.working")}
            chats={dockProps.groups.working}
            open={isOpen(SIDEBAR_DOCK_WORKING_ID)}
            onToggle={() => toggle(SIDEBAR_DOCK_WORKING_ID)}
          />
        </Show>
        <For each={folderIds()}>
          {(sectionId) => (
            <SidebarDockFolder
              sectionId={sectionId}
              groups={dockProps.groups}
              open={isOpen(sectionId)}
              onToggle={() => toggle(sectionId)}
            />
          )}
        </For>
        <SidebarSectionDraft parentId={null} />
        <Show when={settledShown()}>
          <SidebarDockGroup
            id={SIDEBAR_UNASSIGNED_SECTION_ID}
            name={t("sidebar.dock.settled")}
            chats={settled()}
            open={isOpen(SIDEBAR_UNASSIGNED_SECTION_ID)}
            onToggle={() => toggle(SIDEBAR_UNASSIGNED_SECTION_ID)}
          >
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
          </SidebarDockGroup>
        </Show>
      </div>
    </Show>
  );
}
