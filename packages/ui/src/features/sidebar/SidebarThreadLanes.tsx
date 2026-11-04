/**
 * The thread lanes: the list by what each thread needs, not by folder.
 *
 * "Needs you" holds every thread of every agent, its own chat or a side thread, that waits for an
 * answer, an approval or a browser takeover, and the channels that wait. "Working" holds every
 * thread with a running turn. "Agents" holds each agent once: the main one of its copies, without
 * its threads. A copy, or an old thread, shows only in the lanes above while it needs the user or
 * works. An empty lane hides. The channels follow, then the people.
 *
 * The folders of the layout do not show here. The layout keeps them, and the order of "Agents" and
 * "Channels" is the order of the layout.
 */

import { SIDEBAR_PEOPLE_SECTION_ID } from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { Button, buttonVariants, ChevronDown, ContextMenu } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { MAIN_THREAD_ID, threadTabKey } from "../conversation/threads/thread-types";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator, SidebarWaitChip, SidebarWaitTooltip } from "./SidebarAgentIndicator";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarPeopleSection } from "./SidebarPeopleSection";
import { type SidebarAgentFamily, sidebarAgentFamilies, sidebarCopyWords } from "./sidebar-agent-families";
import { sortByLayoutOrder } from "./sidebar-agent-order";
import { sidebarAgentStateLabel } from "./sidebar-filtering";
import { sidebarPinnedItemKey } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";
import { type SidebarThreadLanes as Lanes, SIDEBAR_LANE_IDS, type SidebarThreadEntry } from "./sidebar-types";

/** The relative times of the "Working" rows move on once a minute. */
const CLOCK_TICK_MS = 60_000;

export function SidebarThreadLanes(laneProps: { lanes: Lanes }) {
  const { filteredChats, props, waitingChats } = useSidebarScope();
  const { t } = useText();
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  });
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const hiddenIds = createMemo(() => new Set((props.userHiddenAgents ?? []).map((entry) => entry.agentId)));
  const copyWords = createMemo(() => sidebarCopyWords(props.agents));
  /** A thread of a hidden or unknown agent does not show. */
  const shown = (entry: SidebarThreadEntry) => agentById().has(entry.agentId) && !hiddenIds().has(entry.agentId);
  const waiting = createMemo(() =>
    laneProps.lanes.threads.filter((entry) => entry.state.kind === "waiting" && shown(entry)),
  );
  const working = createMemo(() =>
    laneProps.lanes.threads.filter((entry) => entry.state.kind === "working" && shown(entry)),
  );
  const waitingChannels = createMemo(() =>
    waitingChats().flatMap((chat) => (chat.kind === "channel" ? [chat.channel] : [])),
  );
  const pinnedAgentIds = createMemo(
    () => new Set(props.pinnedItems.map(sidebarPinnedItemKey).filter((key) => key.startsWith("agent:"))),
  );
  /**
   * Each agent once, in the order of the layout. The host lists the oldest agent first, so the main
   * agent of copies is the oldest. A pinned agent shows in the pinned strip instead.
   */
  const families = createMemo(() => {
    const visible = sidebarAgentFamilies(props.agents.filter((agent) => !hiddenIds().has(agent.id))).filter(
      (family) => !pinnedAgentIds().has(sidebarPinnedItemKey({ kind: "agent", id: family.main.id })),
    );
    const byMain = new Map(visible.map((family) => [family.main.id, family]));
    return sortByLayoutOrder(
      visible.map((family) => family.main),
      props.layout.agentOrder,
    ).flatMap((agent) => byMain.get(agent.id) ?? []);
  });
  const channels = createMemo(() => filteredChats().flatMap((chat) => (chat.kind === "channel" ? [chat.channel] : [])));
  return (
    <>
      <SidebarLane
        id={SIDEBAR_LANE_IDS.waiting}
        title={t("sidebar.waiting.title")}
        count={waiting().length + waitingChannels().length}
        tone="waiting"
      >
        <For each={waiting()}>
          {(entry) => (
            <SidebarThreadRow entry={entry} agentById={agentById()} copyWords={copyWords()} lanes={laneProps.lanes} />
          )}
        </For>
        <For each={waitingChannels()}>{(channel) => <SidebarChannelRow channel={channel} waiting />}</For>
      </SidebarLane>
      <SidebarLane id={SIDEBAR_LANE_IDS.working} title={t("sidebar.lanes.working")} count={working().length}>
        <For each={working()}>
          {(entry) => (
            <SidebarThreadRow
              entry={entry}
              agentById={agentById()}
              copyWords={copyWords()}
              lanes={laneProps.lanes}
              now={now()}
            />
          )}
        </For>
      </SidebarLane>
      <SidebarLane id={SIDEBAR_LANE_IDS.agents} title={t("sidebar.lanes.agents")} count={families().length}>
        <For each={families()}>{(family) => <SidebarAgentLaneRow family={family} lanes={laneProps.lanes} />}</For>
      </SidebarLane>
      <SidebarLane id={SIDEBAR_LANE_IDS.channels} title={t("sidebar.lanes.channels")} count={channels().length}>
        <For each={channels()}>{(channel) => <SidebarChannelRow channel={channel} />}</For>
      </SidebarLane>
      <SidebarPeopleSection sectionId={SIDEBAR_PEOPLE_SECTION_ID} />
    </>
  );
}

/** A lane: a heading that collapses it, with its count. It hides while it is empty. */
function SidebarLane(laneProps: {
  id: string;
  title: string;
  count: number;
  tone?: "waiting" | undefined;
  children: JSX.Element;
}) {
  const { props, sectionIsCollapsed } = useSidebarScope();
  const collapsed = () => sectionIsCollapsed(laneProps.id);
  const bodyId = () => `sidebar-lane-body-${laneProps.id.replace(":", "-")}`;
  return (
    <Show when={laneProps.count > 0}>
      <section
        class={[
          "sidebar-chat-group sidebar-section sidebar-lane",
          { "sidebar-lane-waiting": laneProps.tone === "waiting" },
        ]}
        aria-label={laneProps.title}
      >
        <header>
          <Button
            variant="ghost"
            type="button"
            class="sidebar-section-toggle sidebar-lane-toggle"
            aria-expanded={collapsed() ? "false" : "true"}
            aria-controls={bodyId()}
            data-cuelume-open={collapsed() ? "" : undefined}
            data-cuelume-close={collapsed() ? undefined : ""}
            data-cuelume-emphasis="subtle"
            onClick={() => props.onToggleSection(laneProps.id)}
          >
            <span class="sidebar-section-name">{laneProps.title}</span>
            <span class="sidebar-lane-count">{laneProps.count}</span>
            <ChevronDown
              class={`sidebar-section-chevron size-4${collapsed() ? " sidebar-section-chevron-collapsed" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </header>
        <div
          class="sidebar-section-collapse"
          data-collapsed={collapsed() ? "" : undefined}
          aria-hidden={collapsed() ? "true" : undefined}
          inert={collapsed() ? true : undefined}
        >
          <div id={bodyId()} class="sidebar-section-body sidebar-lane-body">
            {laneProps.children}
          </div>
        </div>
      </section>
    </Show>
  );
}

/** How long ago a thread changed: now, minutes, hours, or the day. */
function laneTime(updatedAt: string | null, now: number, t: AppTranslate, format: AppFormat): string {
  if (!updatedAt) return "";
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("sidebar.lanes.justNow");
  if (minutes < 60) return t("sidebar.lanes.minutes", { value: format.number(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("sidebar.lanes.hours", { value: format.number(hours) });
  return format.date(new Date(at), { month: "short", day: "numeric" });
}

/**
 * One thread in "Needs you" or "Working": the agent's face with the state on its corner, the thread
 * title, and the agent's name with its copy word. A waiting row ends with what the user does next,
 * and its tooltip says what the thread waits for.
 */
function SidebarThreadRow(rowProps: {
  entry: SidebarThreadEntry;
  agentById: ReadonlyMap<string, AgentProfile>;
  copyWords: ReadonlyMap<string, string>;
  lanes: Lanes;
  now?: number | undefined;
}) {
  const { props } = useSidebarScope();
  const { t, format } = useText();
  const agent = () => rowProps.agentById.get(rowProps.entry.agentId);
  const key = () => threadTabKey(rowProps.entry.agentId, rowProps.entry.threadId);
  const active = () => rowProps.lanes.activeKey === key();
  const title = () => rowProps.entry.title ?? t("sidebar.lanes.mainChat");
  const copy = () => rowProps.copyWords.get(rowProps.entry.agentId);
  const context = () => {
    const name = agent()?.name ?? "";
    const word = copy();
    return word ? `${name} · ${word}` : name;
  };
  const wait = () => (rowProps.entry.state.kind === "waiting" ? rowProps.entry.state : undefined);
  // A function, not a JSX ternary: the avatar reads its mood inside an effect.
  const mood = () => props.agentMoods[rowProps.entry.agentId] ?? "idle";
  const label = () => `${title()}, ${context()}. ${sidebarAgentStateLabel(rowProps.entry.state, t, format)}`;
  const row = (): JSX.Element => (
    <Show when={agent()}>
      {(profile) => (
        <Button
          variant="ghost"
          type="button"
          class={["sidebar-lane-row", { "sidebar-lane-row-active": active() }]}
          aria-label={label()}
          aria-pressed={active() ? "true" : "false"}
          data-cuelume-navigate=""
          onClick={() => rowProps.lanes.onOpenThread(rowProps.entry.agentId, rowProps.entry.threadId)}
        >
          <span class="agent-row-avatar sidebar-lane-avatar">
            <AgentAvatar agent={profile()} motion="idle" mood={mood()} />
            <SidebarAgentIndicator state={() => rowProps.entry.state} />
          </span>
          <span class="sidebar-lane-copy">
            <span class="sidebar-lane-title">{title()}</span>
            <span class="sidebar-lane-context">{context()}</span>
          </span>
          <Show
            when={wait()}
            fallback={
              <span class="sidebar-lane-time">{laneTime(rowProps.entry.updatedAt, rowProps.now ?? 0, t, format)}</span>
            }
          >
            {(current) => <SidebarWaitChip reason={current().reason} />}
          </Show>
        </Button>
      )}
    </Show>
  );
  return (
    <Show when={wait()} fallback={row()}>
      {(current) => (
        <SidebarWaitTooltip wait={current()} menuOpen={false}>
          {row()}
        </SidebarWaitTooltip>
      )}
    </Show>
  );
}

/**
 * One agent in "Agents": its face, its name and its role title. An agent with a reply that the user
 * did not read, in its own chat or the chat of a copy, has a bright name and a dot. A click opens
 * that chat, else the main agent's own chat.
 */
function SidebarAgentLaneRow(rowProps: { family: SidebarAgentFamily; lanes: Lanes }) {
  const { props } = useSidebarScope();
  const { t } = useText();
  const main = () => rowProps.family.main;
  const unread = () => rowProps.family.members.find((agent) => rowProps.lanes.unreadAgentIds.has(agent.id));
  const target = () => unread() ?? main();
  const active = () =>
    rowProps.family.members.some((agent) => rowProps.lanes.activeKey === threadTabKey(agent.id, MAIN_THREAD_ID));
  const role = () => main().title.trim();
  const mood = () => props.agentMoods[main().id] ?? "idle";
  const label = () => [main().name, role(), unread() ? t("sidebar.lanes.newReply") : ""].filter(Boolean).join(", ");
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger
        as="button"
        type="button"
        class={[
          buttonVariants({ variant: "ghost" }),
          "sidebar-lane-agent",
          { "sidebar-lane-row-active": active(), "sidebar-lane-agent-unread": unread() !== undefined },
        ]}
        aria-label={label()}
        aria-pressed={active() ? "true" : "false"}
        data-cuelume-navigate=""
        onClick={() => rowProps.lanes.onOpenThread(target().id, MAIN_THREAD_ID)}
      >
        <span class="agent-row-avatar sidebar-lane-agent-avatar">
          <AgentAvatar agent={main()} motion="idle" mood={mood()} />
        </span>
        <span class="sidebar-lane-agent-name">{main().name}</span>
        <Show when={role()}>{(text) => <span class="sidebar-lane-agent-role">{text()}</span>}</Show>
        <Show when={unread()}>
          <span class="sidebar-lane-unread-dot" aria-hidden="true" />
        </Show>
      </ContextMenu.Trigger>
      <SidebarAgentContextMenu agent={main()} pinned={false} />
    </ContextMenu.Root>
  );
}
