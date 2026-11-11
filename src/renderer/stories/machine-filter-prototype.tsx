/**
 * Prototype: the "All machines" sidebar as the normal chat sidebar ("Needs you" on top, the dock with
 * "Working", the folders and "Settled" below), with filter chips that choose the machines it shows.
 * The real sidebar renders every section; the prototype adds only the chips and the machine mark at
 * the end of each row.
 */

import {
  type ServerSummary,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { Button, LayoutGrid } from "@openbot/ui";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import type { AgentProfile } from "@openbot/ui/data";
import type { Machine } from "@openbot/ui/features/servers/MachinesPage";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import {
  SIDEBAR_DOCK_OPEN_PREFIX,
  SIDEBAR_DOCK_WORKING_ID,
  type SidebarAgentState,
} from "@openbot/ui/features/sidebar/sidebar-types";
import { Portal } from "@solidjs/web";
import { createMemo, createSignal, createStore, For, onSettled, Show } from "solid-js";
import { fn } from "storybook/test";
import { requireFixture, STORY_AGENTS, STORY_SERVERS } from "./fixtures";
import { storySidebarPages } from "./sidebar-pages-story";
import "./MachineFilterPrototype.css";

const MINUTE = 60_000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

function machine(id: string, name: string, online: boolean, thisComputer = false): Machine {
  return {
    id,
    name,
    logoUrl: null,
    state: online ? "online" : "offline",
    current: id === "macbook",
    thisComputer,
    agents: { status: "loading" },
  };
}

/** The machines, in the order of the server menu. Friends VPS is offline. */
const MACHINES: Machine[] = [
  machine("macbook", "MacBook", true, true),
  machine("personal-vps", "Personal VPS", true),
  machine("resorsi-vps", "Resorsi VPS", true),
  machine("friends-vps", "Friends VPS", false),
];

const machineById = new Map(MACHINES.map((entry) => [entry.id, entry]));

/** Folders of the machines. A folder belongs to one machine, as a section belongs to one server. */
const FOLDERS = [
  { id: "33333333-3333-4333-8333-333333333331", name: "HaloRx", machineId: "resorsi-vps" },
  { id: "33333333-3333-4333-8333-333333333332", name: "Empirical", machineId: "resorsi-vps" },
  { id: "33333333-3333-4333-8333-333333333333", name: "University", machineId: "personal-vps" },
] as const;
export const HALORX_FOLDER_ID = FOLDERS[0].id;
const folderId = (name: string) => FOLDERS.find((folder) => folder.name === name)?.id;

interface Row {
  machineId: string;
  name: string;
  preview: string;
  minutes: number;
  state?: SidebarAgentState;
  folder?: string;
}

/** Every agent of the online machines, with its state and folder. */
const ROWS: Row[] = [
  {
    machineId: "macbook",
    name: "Builder",
    preview: "Building the machine filter.",
    minutes: 1,
    state: { kind: "working" },
  },
  {
    machineId: "personal-vps",
    name: "Inbox",
    preview: "Three mails need a reply today.",
    minutes: 4,
    state: { kind: "waiting", reason: "question", detail: "Reply to Renzo today or Monday?" },
  },
  {
    machineId: "resorsi-vps",
    name: "HaloRx PM",
    preview: "The September tiers file is ready.",
    minutes: 9,
    state: { kind: "waiting", reason: "approval", detail: "Send the September tiers file to Beth" },
    folder: "HaloRx",
  },
  {
    machineId: "resorsi-vps",
    name: "EMPIQ PM",
    preview: "Testing Google sign-in on staging.",
    minutes: 14,
    state: { kind: "working" },
    folder: "Empirical",
  },
  {
    machineId: "personal-vps",
    name: "Writer",
    preview: "Drafting the LinkedIn post.",
    minutes: 22,
    state: { kind: "working" },
  },
  { machineId: "macbook", name: "Designer", preview: "Both MP4 files are in the folder.", minutes: 34 },
  {
    machineId: "resorsi-vps",
    name: "Rebates",
    preview: "The report went to Beth.",
    minutes: 48,
    state: { kind: "unread", count: 1 },
    folder: "HaloRx",
  },
  { machineId: "personal-vps", name: "Calendar", preview: "Thursday has two free hours.", minutes: 60 },
  {
    machineId: "personal-vps",
    name: "UBA notes",
    preview: "The Algebra summary is ready.",
    minutes: 75,
    state: { kind: "unread", count: 2 },
    folder: "University",
  },
  {
    machineId: "resorsi-vps",
    name: "Scout",
    preview: "Read the October rebate files.",
    minutes: 130,
    folder: "HaloRx",
  },
  { machineId: "macbook", name: "Ops", preview: "Colima stopped after an hour idle.", minutes: 190 },
  { machineId: "personal-vps", name: "Finance", preview: "The card bill is due Friday.", minutes: 240 },
  {
    machineId: "personal-vps",
    name: "Research",
    preview: "Found four papers on agent memory.",
    minutes: 900,
    folder: "University",
  },
];

const agentIdOf = (row: Row) => `${row.machineId}-${row.name.toLowerCase().replaceAll(" ", "-")}`;

const AGENTS: AgentProfile[] = ROWS.map((row, index) => ({
  ...requireFixture(STORY_AGENTS[index % STORY_AGENTS.length], "Story agent"),
  id: agentIdOf(row),
  name: row.name,
  title: "",
  threadId: `thread-${agentIdOf(row)}`,
  avatarSeed: row.name,
  preview: row.preview,
  updatedAt: minutesAgo(row.minutes),
}));

const MACHINE_OF_AGENT = new Map(ROWS.map((row) => [agentIdOf(row), row.machineId]));
const MACHINE_OF_NAME = new Map(ROWS.map((row) => [row.name, row.machineId]));

const AGENT_STATES: Record<string, SidebarAgentState> = {};
const AGENT_MOODS: Record<string, AvatarMood> = {};
for (const row of ROWS) {
  if (!row.state) continue;
  AGENT_STATES[agentIdOf(row)] = row.state;
  if (row.state.kind === "working" || row.state.kind === "waiting") AGENT_MOODS[agentIdOf(row)] = row.state.kind;
}

const SERVERS: ServerSummary[] = MACHINES.map((entry) => ({
  ...STORY_SERVERS[0],
  id: entry.id,
  name: entry.name,
  kind: entry.thisComputer ? "local" : "remote",
  state: entry.state === "online" ? "online" : "offline",
  active: false,
}));

/** The machines a filter shows: every one ("all"), or the id of one. */
export type MachineChoice = string;

const shows = (choice: MachineChoice, machineId: string) => choice === "all" || choice === machineId;

/** The layout of the chosen machines: their folders, then "Settled". */
function layoutFor(choice: MachineChoice): SidebarLayoutSnapshot {
  const folders = FOLDERS.filter((folder) => shows(choice, folder.machineId));
  const agentAssignments: Record<string, string> = {};
  for (const row of ROWS) {
    const id = row.folder ? folderId(row.folder) : undefined;
    if (id && shows(choice, row.machineId)) agentAssignments[agentIdOf(row)] = id;
  }
  return {
    revision: 1,
    sections: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    order: [SIDEBAR_PEOPLE_SECTION_ID, ...folders.map((folder) => folder.id), SIDEBAR_UNASSIGNED_SECTION_ID],
    agentAssignments,
    agentOrder: [],
  };
}

const waitingCount = (machineId: string) =>
  ROWS.filter((row) => row.machineId === machineId && row.state?.kind === "waiting").length;
const unreadCount = (machineId: string) =>
  ROWS.filter((row) => row.machineId === machineId && row.state?.kind === "unread").length;

/** The list and the rows of the real sidebar, which the prototype adds to. */
function createSidebarDom() {
  const [dom, setDom] = createStore<{ root: HTMLElement | null; list: Element | null; rows: HTMLElement[] }>({
    root: null,
    list: null,
    rows: [],
  });
  onSettled(() => {
    const root = dom.root;
    if (!root) return;
    const sync = () =>
      setDom((draft) => {
        draft.list = root.querySelector(".agent-list-content");
        draft.rows = [...root.querySelectorAll<HTMLElement>(".sidebar-chat-row")];
      });
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(root, { subtree: true, childList: true });
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
  return {
    dom,
    attach: (root: HTMLElement) =>
      setDom((draft) => {
        draft.root = root;
      }),
  };
}

/** The machine mark at the end of a row, as the real "All machines" rows show it. */
function RowMark(props: { row: HTMLElement }) {
  const found = () => {
    if (props.row.querySelector(".machine-filter-row-mark")) return undefined;
    const name = props.row.querySelector(".sidebar-chat-name")?.textContent ?? "";
    const id = MACHINE_OF_NAME.get(name);
    return id ? machineById.get(id) : undefined;
  };
  return (
    <Show when={found()}>
      {(entry) => (
        <Portal mount={props.row}>
          <span class="sidebar-chat-server machine-filter-row-mark" title={entry().name} aria-hidden="true">
            <ServerMark server={entry()} />
          </span>
        </Portal>
      )}
    </Show>
  );
}

/** How the chips look: names, names with the "Needs you" count, or logos with the chosen name. */
export type ChipLook = "named" | "needs-you" | "logos";

function MachineChips(props: { look: ChipLook; choice: MachineChoice; onChoose: (choice: MachineChoice) => void }) {
  return (
    <div class="machine-filter-chips" data-look={props.look} role="radiogroup" aria-label="Show machines">
      <Button
        type="button"
        variant="ghost"
        role="radio"
        aria-checked={props.choice === "all" ? "true" : "false"}
        class="machine-filter-chip"
        onClick={() => props.onChoose("all")}
      >
        <Show when={props.look === "logos"} fallback="All">
          <LayoutGrid class="size-4" aria-hidden="true" />
          <span class={props.choice === "all" ? undefined : "sr-only"}>All</span>
        </Show>
      </Button>
      <For each={MACHINES} keyed={(entry) => entry.id}>
        {(entry) => {
          const chosen = () => props.choice === entry().id;
          const waits = () => waitingCount(entry().id);
          return (
            <Button
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={chosen() ? "true" : "false"}
              class="machine-filter-chip"
              data-state={entry().state}
              title={entry().name}
              ref={(element: HTMLElement) => {
                if (!chosen()) return;
                requestAnimationFrame(() => {
                  const strip = element.parentElement;
                  if (strip && element.offsetLeft + element.offsetWidth > strip.clientWidth)
                    strip.scrollLeft = element.offsetLeft - 48;
                });
              }}
              onClick={() => props.onChoose(entry().id)}
            >
              <span class="sidebar-chat-server machine-filter-chip-mark" aria-hidden="true">
                <ServerMark server={entry()} />
              </span>
              <span class={props.look === "logos" && !chosen() ? "sr-only" : undefined}>{entry().name}</span>
              <Show when={props.look === "needs-you" && waits() > 0}>
                <span class="machine-filter-wait-count">{waits()}</span>
              </Show>
              <Show when={props.look !== "needs-you" && waits() + unreadCount(entry().id) > 0}>
                <span class={["machine-filter-dot", { "machine-filter-dot-wait": waits() > 0 }]} aria-hidden="true" />
              </Show>
            </Button>
          );
        }}
      </For>
    </div>
  );
}

/** The real chat sidebar with the agents of the chosen machine, and the chips over its list. */
export function MachineChipsVariant(props: { look: ChipLook; choice?: MachineChoice; openGroup?: string }) {
  const sidebar = createSidebarDom();
  const [choice, setChoice] = createSignal<MachineChoice>(props.choice ?? "all");
  const [active, setActive] = createSignal("macbook-builder");
  const [collapsed, setCollapsed] = createSignal<string[]>([
    `${SIDEBAR_DOCK_OPEN_PREFIX}${props.openGroup ?? SIDEBAR_DOCK_WORKING_ID}`,
  ]);
  const toggleSection = (sectionId: string) =>
    setCollapsed((current) =>
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId],
    );
  const agents = createMemo(() => AGENTS.filter((agent) => shows(choice(), MACHINE_OF_AGENT.get(agent.id) ?? "")));
  const offline = () => MACHINES.filter((entry) => entry.state !== "online" && shows(choice(), entry.id));
  return (
    <div class="machine-filter-frame" ref={sidebar.attach}>
      <div class="app-frame machine-filter-sidebar">
        <Sidebar
          serverName="MacBook"
          onOpenServerSettings={fn()}
          serverMenu={{
            servers: SERVERS,
            view: "menu",
            onViewChange: fn(),
            onSelect: fn(),
            onAdd: fn(),
            onSetMuted: fn(),
            onOpenNotificationSettings: fn(),
            onOpenSettings: fn(),
            allMachines: { active: true, onSelect: fn() },
          }}
          agents={agents()}
          activeAgentId={active()}
          people={[]}
          directThreads={[]}
          activeDirectMemberId={null}
          agentStates={AGENT_STATES}
          agentMoods={AGENT_MOODS}
          layout={layoutFor(choice())}
          collapsedSectionIds={collapsed()}
          onMutateLayout={fn(async () => undefined)}
          onToggleSection={toggleSection}
          pinnedItems={[]}
          peopleOrder={[]}
          onPin={fn()}
          onUnpin={fn()}
          onReorderPinned={fn()}
          onReorderPeople={fn()}
          onSelectAgent={setActive}
          onSelectPerson={fn()}
          onCreateAgent={fn()}
          onEditAgent={fn()}
          onDeleteAgent={async () => undefined}
          compact={false}
          onExpand={fn()}
          onOpenSearch={fn()}
          onOpenMarketplace={fn()}
          pages={storySidebarPages()}
        />
      </div>
      <div class="machine-filter-window" aria-hidden="true" />
      <Show when={sidebar.dom.list} keyed>
        {(list) => (
          <Portal mount={list}>
            <MachineChips look={props.look} choice={choice()} onChoose={setChoice} />
            <For each={offline()} keyed={(entry) => entry.id}>
              {(entry) => (
                <p class="sidebar-machine-notice machine-filter-offline">
                  {entry().name} is offline. Its agents show when it connects.
                </p>
              )}
            </For>
          </Portal>
        )}
      </Show>
      <Show when={choice() === "all"}>
        <For each={sidebar.dom.rows}>{(row) => <RowMark row={row} />}</For>
      </Show>
    </div>
  );
}
