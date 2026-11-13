/**
 * The groups of the open chat list.
 *
 * The list is one scroll: the pinned chats and "Needs you" come first, then the groups, each with a
 * quiet heading in line with the rows: "Working", each folder at the top of the layout in the layout
 * order, then "Settled", the chats in no folder. Each chat is in one group: a chat that waits is in
 * "Needs you" (an agent whose wait is only in a side thread too), one that works (or a channel with a
 * running task) is in "Working", and the others are in their folder or in "Settled". People, the hidden
 * agents and the deleted channels follow the chats of "Settled".
 *
 * Each group opens and closes by itself. The open groups are saved with the collapsed sections
 * (`dockOpenGroups` in the scope), so they stay open after a restart. A folder group keeps the menu,
 * the drag and the drop of its section. A floating "unread" button under the list shows how many
 * unread chats are out of view, below the list or in a closed group, and goes to the next one.
 */

import { SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { Button, ChevronDown } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
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

/** The body of a group. It is in the DOM while closed, so it opens and closes with the section motion. */
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

/** A folder at the top of the layout, as a group of the list. The folders in it show inside. */
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

/** A folder in a folder: its chats, then the folders in it, with the same quiet heading as a top folder. */
function SidebarChatFolder(folderProps: { sectionId: string; depth: number; groups: SidebarChatDockGroups }) {
  const {
    customSectionById,
    dragOffset,
    sectionChildren,
    sectionDragClasses,
    sectionIsCollapsed,
    sectionLabel,
    toggleSection,
  } = useSidebarScope();
  const unread = useChatUnread();
  const sectionId = () => folderProps.sectionId;
  const collapsed = () => sectionIsCollapsed(sectionId());
  const deep = createMemo(() => folderChatsDeep(sectionId(), folderProps.groups, sectionChildren));
  return (
    <section
      class={["sidebar-chat-group sidebar-section sidebar-chat-folder-group", sectionDragClasses(sectionId())]}
      style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
      aria-label={sectionLabel(sectionId())}
      data-section-id={sectionId()}
      data-depth={String(folderProps.depth)}
    >
      <SidebarSectionHeader
        sectionId={sectionId()}
        name={customSectionById().get(sectionId())?.name ?? ""}
        depth={folderProps.depth}
        dock={{
          count: deep().length,
          unread: deep().some(unread),
          open: !collapsed(),
          onToggle: () => toggleSection(sectionId()),
        }}
      />
      <div
        class="sidebar-section-collapse"
        data-collapsed={collapsed() ? "" : undefined}
        aria-hidden={collapsed() ? "true" : undefined}
        inert={collapsed() ? true : undefined}
      >
        <div id={`sidebar-section-body-${sectionId()}`} class="sidebar-section-body">
          <div class="sidebar-dock-body">
            <SidebarChatRows chats={folderProps.groups.bySection.get(sectionId()) ?? []} />
            <For each={sectionChildren(sectionId())}>
              {(childId) => (
                <SidebarChatFolder sectionId={childId} depth={folderProps.depth + 1} groups={folderProps.groups} />
              )}
            </For>
            <SidebarSectionDraft parentId={sectionId()} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Which groups the list shows, and which of them are open. */
export interface SidebarDockOpenState {
  /** The folders at the top of the layout, in its order. */
  folderIds: () => readonly string[];
  /** The chats in no folder. */
  settled: () => readonly SidebarChatItem[];
  /** Whether "Settled" shows: it has chats, People, hidden agents or deleted channels. */
  settledShown: () => boolean;
  isOpen: (groupId: string) => boolean;
  /** Opens or closes one group. The other groups keep their state. */
  toggle: (groupId: string) => void;
}

/** The groups on screen and their open state. The list and its unread button share it. */
export function useSidebarDockOpenState(groups: () => SidebarChatDockGroups): SidebarDockOpenState {
  const {
    customSectionById,
    dockOpenGroups,
    orderedPeople,
    props,
    sectionParent,
    setDockOpenGroups,
    userHiddenAgentList,
  } = useSidebarScope();
  const folderIds = createMemo(() =>
    props.layout.order.filter((sectionId) => customSectionById().has(sectionId) && sectionParent(sectionId) === null),
  );
  /** A chat whose folder is not in the layout any more counts as in none. */
  const settled = createMemo(() => [
    ...(groups().bySection.get(SIDEBAR_UNASSIGNED_SECTION_ID) ?? []),
    ...[...groups().bySection].flatMap(([sectionId, chats]) =>
      sectionId !== SIDEBAR_UNASSIGNED_SECTION_ID && !customSectionById().has(sectionId) ? chats : [],
    ),
  ]);
  const people = () => props.showPeople !== false && orderedPeople().length > 0;
  const settledShown = () =>
    settled().length > 0 || people() || userHiddenAgentList().length > 0 || props.showingArchivedChannels === true;
  /** The groups on screen, in their order. */
  const shownIds = createMemo(() => [
    ...(groups().working.length > 0 ? [SIDEBAR_DOCK_WORKING_ID] : []),
    ...folderIds(),
    ...(settledShown() ? [SIDEBAR_UNASSIGNED_SECTION_ID] : []),
  ]);
  /**
   * The open groups on screen. When the user left groups open but none of them is on screen, such as
   * "Working" while no chat works, the list opens "Settled", or else its first group.
   */
  const openIds = createMemo<readonly string[]>(() => {
    const saved = dockOpenGroups();
    const shown = saved.filter((id) => shownIds().includes(id));
    if (saved.length === 0 || shown.length > 0) return shown;
    const fallback = shownIds().includes(SIDEBAR_UNASSIGNED_SECTION_ID) ? SIDEBAR_UNASSIGNED_SECTION_ID : shownIds()[0];
    return fallback === undefined ? [] : [fallback];
  });
  const isOpen = (groupId: string) => openIds().includes(groupId);
  const toggle = (groupId: string) =>
    setDockOpenGroups(isOpen(groupId) ? openIds().filter((id) => id !== groupId) : [...openIds(), groupId]);
  return { folderIds, settled, settledShown, isOpen, toggle };
}

/** The groups of the list, under "Needs you". They scroll with the rows. It hides while it has no group. */
export function SidebarChatDock(dockProps: { groups: SidebarChatDockGroups; open: SidebarDockOpenState }) {
  const { pending, props } = useSidebarScope();
  const { t } = useText();
  const open = () => dockProps.open;
  const draftShown = () => {
    const target = pending.sectionEditor?.target;
    return target?.kind === "create" && (target.parentId ?? null) === null;
  };
  return (
    <Show
      when={
        dockProps.groups.working.length > 0 || open().folderIds().length > 0 || open().settledShown() || draftShown()
      }
    >
      <div class="sidebar-dock">
        <Show when={dockProps.groups.working.length > 0}>
          <SidebarDockGroup
            id={SIDEBAR_DOCK_WORKING_ID}
            name={t("sidebar.lanes.working")}
            chats={dockProps.groups.working}
            open={open().isOpen(SIDEBAR_DOCK_WORKING_ID)}
            onToggle={() => open().toggle(SIDEBAR_DOCK_WORKING_ID)}
          />
        </Show>
        <For each={open().folderIds()}>
          {(sectionId) => (
            <SidebarDockFolder
              sectionId={sectionId}
              groups={dockProps.groups}
              open={open().isOpen(sectionId)}
              onToggle={() => open().toggle(sectionId)}
            />
          )}
        </For>
        <SidebarSectionDraft parentId={null} />
        <Show when={open().settledShown()}>
          <SidebarDockGroup
            id={SIDEBAR_UNASSIGNED_SECTION_ID}
            name={t("sidebar.dock.settled")}
            chats={open().settled()}
            open={open().isOpen(SIDEBAR_UNASSIGNED_SECTION_ID)}
            onToggle={() => open().toggle(SIDEBAR_UNASSIGNED_SECTION_ID)}
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

const BODY_PREFIX = "sidebar-section-body-";

/** The unread rows of the groups that the user cannot see: in a closed group, or under the visible list. */
function hiddenUnreadRows(list: HTMLElement): HTMLElement[] {
  const dock = list.querySelector(".sidebar-dock");
  if (!dock) return [];
  const scroller = list.querySelector(".sidebar-chat-scroll");
  // On a phone the whole list scrolls; on a larger screen only the scroll zone in it does.
  const bottom = Math.min(
    list.getBoundingClientRect().bottom,
    scroller?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY,
    window.innerHeight,
  );
  return [...dock.querySelectorAll<HTMLElement>(".sidebar-chat-row[data-unread]")].filter((row) => {
    if (row.closest("[data-collapsed]")) return true;
    const rect = row.getBoundingClientRect();
    return rect.top + rect.height / 2 > bottom;
  });
}

/** The groups that hold a row and are closed, outermost first. */
function closedGroupsOf(row: HTMLElement): string[] {
  const ids: string[] = [];
  for (
    let node = row.closest("[data-collapsed]");
    node;
    node = node.parentElement?.closest("[data-collapsed]") ?? null
  ) {
    const body = node.querySelector(`:scope > [id^="${BODY_PREFIX}"]`);
    if (body) ids.unshift(body.id.slice(BODY_PREFIX.length));
  }
  return ids;
}

/**
 * The floating "3 unread" button under the list. It counts the unread chats of the groups that are
 * out of view, and a click opens the group of the next one and scrolls to it. It hides while every
 * unread chat is in view.
 */
export function SidebarUnreadJump(jumpProps: { list: () => HTMLElement | undefined; open: SidebarDockOpenState }) {
  const { sectionIsCollapsed, toggleSection } = useSidebarScope();
  const { t } = useText();
  const [count, setCount] = createSignal(0);
  let frame: number | null = null;
  const measure = () => {
    frame = null;
    const list = jumpProps.list();
    setCount(list ? hiddenUnreadRows(list).length : 0);
  };
  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(measure);
  };
  onSettled(() => {
    const list = jumpProps.list();
    if (!list) return;
    const mutations = new MutationObserver(schedule);
    mutations.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-unread", "data-collapsed"],
    });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(list);
    const content = list.querySelector(".sidebar-chat-scroll > .agent-list-content");
    if (content) sizes.observe(content);
    list.addEventListener("scroll", schedule, { capture: true, passive: true });
    list.addEventListener("transitionend", schedule);
    schedule();
    return () => {
      mutations.disconnect();
      sizes.disconnect();
      list.removeEventListener("scroll", schedule, { capture: true });
      list.removeEventListener("transitionend", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });
  const jump = () => {
    const list = jumpProps.list();
    const row = list ? hiddenUnreadRows(list)[0] : undefined;
    if (!row) return;
    const opened = closedGroupsOf(row);
    for (const groupId of opened) {
      if (
        jumpProps.open.folderIds().includes(groupId) ||
        groupId === SIDEBAR_DOCK_WORKING_ID ||
        groupId === SIDEBAR_UNASSIGNED_SECTION_ID
      ) {
        if (!jumpProps.open.isOpen(groupId)) jumpProps.open.toggle(groupId);
      } else if (sectionIsCollapsed(groupId)) {
        toggleSection(groupId);
      }
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveal = () => {
      row.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      row.focus({ preventScroll: true });
    };
    // An opened group grows with the section motion, so the row has its place when the motion ends.
    const outer = opened[0] ? document.getElementById(`${BODY_PREFIX}${opened[0]}`)?.parentElement : null;
    if (!outer || reduced) {
      requestAnimationFrame(reveal);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      outer.removeEventListener("transitionend", onEnd);
      reveal();
    };
    // The fade ends before the height does, so only the end of the height says that the row has its place.
    const onEnd = (event: TransitionEvent) => {
      if (event.target === outer && event.propertyName === "grid-template-rows") finish();
    };
    outer.addEventListener("transitionend", onEnd);
    // A motion that does not run sends no event.
    setTimeout(finish, 400);
  };
  return (
    <Show when={count() > 0}>
      <div class="sidebar-unread-jump-wrap">
        <Button type="button" class="sidebar-unread-jump" onClick={jump}>
          <span>{t("sidebar.folder.unread", { count: count() })}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
    </Show>
  );
}
