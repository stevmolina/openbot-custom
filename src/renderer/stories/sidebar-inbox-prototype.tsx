/**
 * Prototype: the chat sidebar with the chats that need the user at the top, and the other groups
 * (Working, Assigned, the user's folders, Settled) docked at the bottom, above the pill.
 *
 * Each variant renders the real app. Only the chat list of the real sidebar is swapped: the top row,
 * the usage tab, the pill and the chat panel stay the app's own. The rows are the real chat rows.
 */

import type { AgentEvent, ClientAgentSummary } from "@openbot/contracts/ipc";
import { ChevronRight, Folder, SlidingTabs } from "@openbot/ui";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import type { AgentProfile } from "@openbot/ui/data";
import { SidebarChatRow } from "@openbot/ui/features/sidebar/SidebarChatRow";
import { createSidebarScope, SidebarScopeContext } from "@openbot/ui/features/sidebar/sidebar-scope";
import type { SidebarAgentState, SidebarChatItem, SidebarProps } from "@openbot/ui/features/sidebar/sidebar-types";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import type { MockOpenBotControls } from "../src/preview/mock-openbot";
import { requireFixture, STORY_AGENT_SUMMARIES } from "./fixtures";
import { AppSlot, createAppDom, PrototypeApp } from "./prototype-support";
import "./SidebarInboxPrototype.css";

// ---------------------------------------------------------------------------------------------
// Data: the three story agents that wait, plus agents for each docked group.

const base = requireFixture(STORY_AGENT_SUMMARIES[0], "Story agent summary");
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function extraAgent(
  id: string,
  name: string,
  title: string,
  hue: ClientAgentSummary["avatarHue"],
  preview: string,
  minutes: number,
) {
  return {
    ...base,
    id,
    name,
    title,
    threadId: `thread-${id}`,
    workspacePath: `/mock/OpenBot/Agents/${id}`,
    avatarSeed: id,
    avatarHue: hue,
    preview,
    updatedAt: minutesAgo(minutes),
  } satisfies ClientAgentSummary;
}

const AGENT_SUMMARIES: ClientAgentSummary[] = [
  ...STORY_AGENT_SUMMARIES.map((agent, index) => ({ ...agent, updatedAt: minutesAgo(index * 3 + 1) })),
  extraAgent("builder", "Builder", "Ships OpenBot changes", 280, "Building the all machines sidebar.", 7),
  extraAgent("scout", "Scout", "Reads client files", 30, "Reading the October rebate files.", 2),
  extraAgent("ops", "Ops", "Runs the servers", 215, "Vic assigned you: review the Signal upgrade.", 60),
  extraAgent("recruiter", "Recruiter", "Finds creators", 320, "Mark assigned you: approve 3 affiliate pitches.", 90),
  extraAgent("halo-pm", "HaloRx PM", "HaloRx project manager", 0, "Uploaded the September tiers file.", 12),
  extraAgent("rebates", "Rebates", "Builds rebate reports", 55, "The report went to Beth.", 140),
  extraAgent("empiq", "EMPIQ PM", "Empirical project manager", 150, "Google sign-in is live on staging.", 35),
  extraAgent("writer", "Writer", "Writes release notes", 100, "Release notes are in the changelog.", 300),
  extraAgent("designer", "Designer", "Makes mockups", 245, "Both MP4 files are in the folder.", 600),
];

const AGENTS: AgentProfile[] = AGENT_SUMMARIES.map((agent) => ({
  id: agent.id,
  provider: agent.provider,
  name: agent.name,
  title: agent.title,
  description: agent.description,
  notifications: agent.notifications,
  model: agent.model,
  reasoningEffort: agent.reasoningEffort,
  threadId: agent.threadId,
  workspacePath: agent.workspacePath,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: agent.avatarUrl,
  time: "",
  preview: agent.preview,
}));

const AGENT_STATES: Record<string, SidebarAgentState> = {
  research: { kind: "waiting", reason: "question", detail: "Which region should we launch in first?" },
  chief: { kind: "waiting", reason: "approval", detail: "bun run release:publish" },
  sales: { kind: "waiting", reason: "takeover", detail: null },
  builder: { kind: "working" },
  scout: { kind: "working" },
  "halo-pm": { kind: "unread", count: 2 },
  empiq: { kind: "unread", count: 1 },
};

const AGENT_MOODS: Record<string, AvatarMood> = {
  research: "waiting",
  chief: "waiting",
  sales: "waiting",
  builder: "working",
  scout: "working",
};

/** The groups of the list. Each chat is in one group. */
export interface InboxGroup {
  id: string;
  name: string;
  folder?: boolean;
  ids: readonly string[];
}

const NEEDS_YOU = ["research", "chief", "sales"];
export const DOCK_GROUPS: InboxGroup[] = [
  { id: "working", name: "Working", ids: ["scout", "builder"] },
  { id: "assigned", name: "Assigned", ids: ["ops", "recruiter"] },
  { id: "halorx", name: "HaloRx", folder: true, ids: ["halo-pm", "rebates"] },
  { id: "empirical", name: "Empirical", folder: true, ids: ["empiq"] },
  { id: "settled", name: "Settled", ids: ["writer", "designer"] },
];

/** The same waits as the "Needs you" app story, so the real chats show the real question, approval and takeover. */
const WAITING_EVENTS: AgentEvent[] = [
  {
    type: "prompt",
    requestId: "proto-question",
    agentId: "research",
    threadId: "thread-research",
    turnId: "turn-research-wait",
    questions: [
      {
        id: "region",
        header: "Region",
        question: "Which region should we launch in first?",
        isSecret: false,
        options: [
          { label: "EU", description: "Start with the EU store." },
          { label: "US", description: "Start with the US store." },
        ],
      },
    ],
  },
  {
    type: "approval",
    approval: {
      requestId: "proto-approval",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-chief-wait",
      kind: "command",
      command: "bun run release:publish",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    },
  },
  {
    type: "browser-takeover-requested",
    request: {
      requestId: "proto-takeover",
      agentId: "sales",
      threadId: "thread-sales",
      turnId: "turn-sales-wait",
      tabId: "story-tab",
    },
  },
];

function addWaits(mock: MockOpenBotControls) {
  const subscribe = mock.api.agent.onEvent;
  mock.api.agent.onEvent = (listener) => {
    const unsubscribe = subscribe(listener);
    queueMicrotask(() => {
      for (const event of WAITING_EVENTS) mock.emitAgentEvent(event);
    });
    return unsubscribe;
  };
}

// ---------------------------------------------------------------------------------------------
// The app with the swapped list.

const noop = () => undefined;

/** Props for the scope of the prototype list. Only the rows read them. */
function prototypeSidebarProps(active: () => string | null, onSelect: (id: string) => void): SidebarProps {
  return {
    serverName: "Mac",
    onOpenServerSettings: noop,
    agents: AGENTS,
    get activeAgentId() {
      return active() ?? "";
    },
    people: [],
    directThreads: [],
    activeDirectMemberId: null,
    agentStates: AGENT_STATES,
    agentMoods: AGENT_MOODS,
    layout: defaultSidebarLayout(),
    collapsedSectionIds: [],
    onMutateLayout: async () => undefined,
    onToggleSection: noop,
    pinnedItems: [],
    peopleOrder: [],
    onPin: noop,
    onUnpin: noop,
    onReorderPinned: noop,
    onReorderPeople: noop,
    onSelectAgent: onSelect,
    onSelectPerson: noop,
    onCreateAgent: noop,
    onEditAgent: noop,
    onDeleteAgent: async () => undefined,
    compact: false,
    onExpand: noop,
    onOpenSearch: noop,
    onOpenMarketplace: noop,
  };
}

const chatOf = (id: string): SidebarChatItem => {
  const agent = AGENTS.find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`Prototype agent ${id} is missing.`);
  return { kind: "agent", id, agent };
};

/** The rows of a group, as the real chat list draws them. */
export function Rows(props: { ids: readonly string[] }) {
  return (
    <div class="sidebar-chat-rows">
      <For each={props.ids}>{(id) => <SidebarChatRow chat={chatOf(id)} look="row" />}</For>
    </div>
  );
}

/** The faces of a group, as the collapsed sidebar draws them. */
export function Faces(props: { ids: readonly string[] }) {
  return (
    <div class="inbox-proto-faces">
      <For each={props.ids}>{(id) => <SidebarChatRow chat={chatOf(id)} look="face" />}</For>
    </div>
  );
}

/** The "Needs you" group at the top, with the real heading. */
export function NeedsYou() {
  return (
    <section class="sidebar-chat-group sidebar-chat-folder-group" aria-label={`Needs you, ${NEEDS_YOU.length}`}>
      <header class="inbox-proto-top-head">
        <h2 class="sidebar-chat-folder-title">Needs you</h2>
        <span class="inbox-proto-count inbox-proto-count-warn">{NEEDS_YOU.length}</span>
      </header>
      <Rows ids={NEEDS_YOU} />
    </section>
  );
}

/** A group heading of the dock: an open state, a name, a count. */
export function DockHeading(props: { group: InboxGroup; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="inbox-proto-dock-head"
      aria-expanded={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <ChevronRight class="inbox-proto-chevron" aria-hidden="true" />
      <Show when={props.group.folder}>
        <Folder class="inbox-proto-folder" aria-hidden="true" />
      </Show>
      <span class="inbox-proto-dock-name">{props.group.name}</span>
      <span class="inbox-proto-count">{props.group.ids.length}</span>
    </button>
  );
}

/** Opens a chat the way the user does: a click on its row in the app's own (hidden) list. */
function openInApp(root: HTMLElement | null, id: string) {
  const name = AGENTS.find((agent) => agent.id === id)?.name;
  if (!root || !name) return;
  const rows = root.querySelectorAll<HTMLElement>("nav.sidebar-chat-list .sidebar-chat-row");
  for (const row of rows) {
    if (row.getAttribute("aria-label")?.startsWith(`${name}.`)) {
      row.click();
      return;
    }
  }
}

/** The real app, with `list` in place of the chat list of the sidebar. */
export function InboxPrototypeApp(props: { variant: string; list: () => JSX.Element; swap?: boolean }) {
  const app = createAppDom();
  const [active, setActive] = createSignal<string | null>("chief");
  const scope = createSidebarScope(
    prototypeSidebarProps(active, (id) => {
      setActive(id);
      openInApp(app.dom.root, id);
    }),
  );
  return (
    <div
      class={["inbox-proto", `inbox-proto-${props.variant}`, { "inbox-proto-swapped": props.swap !== false }]}
      ref={app.attach}
    >
      <PrototypeApp options={{ agents: AGENT_SUMMARIES }} setup={addWaits} />
      <Show when={props.swap !== false}>
        <AppSlot app={app} slot="sidebar">
          <SidebarScopeContext value={scope}>
            <div class="inbox-proto-list">{props.list()}</div>
          </SidebarScopeContext>
        </AppSlot>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The variants.

/** A. The groups at the bottom open one at a time, upward. */
export function AccordionDockVariant() {
  const [open, setOpen] = createSignal<string | null>("working");
  return (
    <InboxPrototypeApp
      variant="a"
      list={() => (
        <>
          <div class="inbox-proto-top">
            <NeedsYou />
          </div>
          <div class="inbox-proto-dock">
            <For each={DOCK_GROUPS}>
              {(group) => (
                <section class="inbox-proto-dock-group" aria-label={group.name}>
                  <DockHeading
                    group={group}
                    open={open() === group.id}
                    onToggle={() => setOpen(open() === group.id ? null : group.id)}
                  />
                  <Show when={open() === group.id}>
                    <div class="inbox-proto-dock-body">
                      <Rows ids={group.ids} />
                    </div>
                  </Show>
                </section>
              )}
            </For>
          </div>
        </>
      )}
    />
  );
}

const TABS = [
  { id: "working", name: "Working", groups: ["working"] },
  { id: "assigned", name: "Assigned", groups: ["assigned"] },
  { id: "folders", name: "Folders", groups: ["halorx", "empirical"] },
  { id: "settled", name: "Settled", groups: ["settled"] },
];

/** B. One drawer with a fixed height at the bottom; tabs switch it. */
export function TabbedDrawerVariant() {
  const [tab, setTab] = createSignal("working");
  return (
    <InboxPrototypeApp
      variant="b"
      list={() => (
        <>
          <div class="inbox-proto-top">
            <NeedsYou />
          </div>
          <div class="inbox-proto-dock">
            <SlidingTabs.Root value={tab()} onChange={setTab}>
              <SlidingTabs.List aria-label="Other chats" class="inbox-proto-tabs">
                <For each={TABS}>
                  {(item) => <SlidingTabs.Trigger value={item.id}>{item.name}</SlidingTabs.Trigger>}
                </For>
              </SlidingTabs.List>
              <SlidingTabs.ContentSlot>
                <For each={TABS}>
                  {(item) => (
                    <SlidingTabs.Content value={item.id} class="inbox-proto-drawer">
                      <For each={DOCK_GROUPS.filter((group) => item.groups.includes(group.id))}>
                        {(group) => (
                          <>
                            <Show when={group.folder}>
                              <h3 class="sidebar-chat-folder-title inbox-proto-subhead">{group.name}</h3>
                            </Show>
                            <Rows ids={group.ids} />
                          </>
                        )}
                      </For>
                    </SlidingTabs.Content>
                  )}
                </For>
              </SlidingTabs.ContentSlot>
            </SlidingTabs.Root>
          </div>
        </>
      )}
    />
  );
}

/** C. The bottom groups are lines of faces, as the collapsed sidebar draws them. */
export function FaceShelfVariant() {
  return (
    <InboxPrototypeApp
      variant="c"
      list={() => (
        <>
          <div class="inbox-proto-top">
            <NeedsYou />
          </div>
          <div class="inbox-proto-dock">
            <For each={DOCK_GROUPS}>
              {(group) => (
                <section class="inbox-proto-shelf" aria-label={group.name}>
                  <span class="inbox-proto-shelf-name">
                    <Show when={group.folder}>
                      <Folder class="inbox-proto-folder" aria-hidden="true" />
                    </Show>
                    {group.name}
                  </span>
                  <Faces ids={group.ids} />
                </section>
              )}
            </For>
          </div>
        </>
      )}
    />
  );
}

/** The app as it is now, with the same chats, for comparison. */
export function CurrentSidebarVariant() {
  return <InboxPrototypeApp variant="current" swap={false} list={() => null} />;
}
