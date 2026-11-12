import {
  type ChannelSummary,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import type { Machine } from "@openbot/ui/features/servers/MachinesPage";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { mergeAllMachinesSidebar } from "../src/features/servers/all-machines-sidebar";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { requireFixture, STORY_AGENTS, STORY_SERVERS } from "./fixtures";
import { SettledArgs } from "./settled-args";
import { storySidebarPages } from "./sidebar-pages-story";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** More agents than the fixtures have, so each group of the dock holds a few. */
const EXTRA_AGENTS = [
  ["builder", "Builder", "Building the all machines sidebar."],
  ["scout", "Scout", "Reading the October rebate files."],
  ["halo-pm", "HaloRx PM", "Uploaded the September tiers file."],
  ["rebates", "Rebates", "The report went to Beth."],
  ["empiq", "EMPIQ PM", "Google sign-in is live on staging."],
  ["writer", "Writer", "Release notes are in the changelog."],
  ["designer", "Designer", "Both MP4 files are in the folder."],
] as const;

/** Each agent with a last message and its time, so the list sorts by recency. */
const agents = [
  ...STORY_AGENTS,
  ...EXTRA_AGENTS.map(([id, name, preview], index) => ({
    ...requireFixture(STORY_AGENTS[index % STORY_AGENTS.length], "Story agent"),
    id,
    name,
    title: "",
    threadId: `thread-${id}`,
    avatarSeed: id,
    preview,
  })),
].map((agent, index) => ({
  ...agent,
  preview:
    index < STORY_AGENTS.length
      ? ([
          "Your biggest opportunity is the pricing page.",
          "Both MP4 files are in the folder.",
          "I opened the hero in the preview so you can compare both versions.",
        ][index % 3] ?? agent.preview)
      : agent.preview,
  updatedAt: minutesAgo(index * 7 + 1),
}));

const firstId = agents[0]?.id ?? "";
const secondId = agents[1]?.id ?? "";
const thirdId = agents[2]?.id ?? "";

const agentStates: Record<string, SidebarAgentState> = {
  [secondId]: { kind: "working" },
  builder: { kind: "working" },
  [thirdId]: { kind: "waiting", reason: "approval", detail: "Post 3 drafts to LinkedIn" },
  scout: { kind: "waiting", reason: "question", detail: "Which month should the report cover?" },
  [firstId]: { kind: "unread", count: 2 },
  rebates: { kind: "unread", count: 1 },
};

const agentMoods: Record<string, AvatarMood> = {
  [secondId]: "working",
  builder: "working",
  [thirdId]: "waiting",
  scout: "waiting",
};

/** Two folders at the top of the layout, and one folder in the first. */
const haloRxId = "33333333-3333-4333-8333-333333333331";
const reportsId = "33333333-3333-4333-8333-333333333332";
const empiricalId = "33333333-3333-4333-8333-333333333333";
const folderLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: haloRxId, name: "HaloRx" },
    { id: reportsId, name: "Reports", parentId: haloRxId },
    { id: empiricalId, name: "Empirical" },
  ],
  order: [SIDEBAR_PEOPLE_SECTION_ID, haloRxId, reportsId, empiricalId, SIDEBAR_UNASSIGNED_SECTION_ID],
  agentAssignments: { "halo-pm": haloRxId, scout: haloRxId, rebates: reportsId, empiq: empiricalId },
  agentOrder: [],
};

const channels: ChannelSummary[] = [
  {
    id: "launch",
    name: "Launch",
    title: "",
    instructions: "",
    members: agents.slice(0, 3).map((agent) => ({ agentId: agent.id })),
    leadAgentId: null,
    archived: false,
    revision: 1,
    createdAt: minutesAgo(600),
    unreadCount: 1,
    activeTasks: 0,
    lastMessage: { at: minutesAgo(12), text: "The landing page is live.", authorName: "Chief" },
  },
];

const nowSeconds = Math.floor(Date.now() / 1_000);
const usageRows = accountUsageProviderRows({
  limits: [
    {
      id: "claude",
      primary: { usedPercent: 38, windowDurationMins: 300, resetsAt: nowSeconds + 7_200 },
      secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: nowSeconds + 300_000 },
    },
    {
      id: "codex",
      primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: nowSeconds + 3_600 },
      secondary: { usedPercent: 45, windowDurationMins: 10_080, resetsAt: nowSeconds + 400_000 },
    },
    {
      id: "gemini",
      primary: { usedPercent: 12, windowDurationMins: 1_440, resetsAt: nowSeconds + 50_000 },
      secondary: null,
    },
    {
      id: "cursor",
      primary: { usedPercent: 54, windowDurationMins: 43_200, resetsAt: nowSeconds + 900_000 },
      secondary: null,
    },
  ],
});

const args: Parameters<typeof Sidebar>[0] = {
  serverName: "Personal",
  onOpenServerSettings: fn(),
  serverMenu: {
    servers: STORY_SERVERS,
    view: "menu",
    onViewChange: fn(),
    onSelect: fn(),
    onAdd: fn(),
    onSetMuted: fn(),
    onOpenNotificationSettings: fn(),
    onOpenSettings: fn(),
  },
  agents,
  activeAgentId: firstId,
  people: [],
  directThreads: [],
  activeDirectMemberId: null,
  agentStates,
  agentMoods,
  channels,
  onSelectChannel: fn(),
  onCreateChannel: fn(),
  layout: folderLayout,
  collapsedSectionIds: [],
  onMutateLayout: fn(async () => undefined),
  onToggleSection: fn(),
  pinnedItems: [],
  peopleOrder: [],
  onPin: fn(),
  onUnpin: fn(),
  onReorderPinned: fn(),
  onReorderPeople: fn(),
  onSelectAgent: fn(),
  onSelectPerson: fn(),
  onCreateAgent: fn(),
  onEditAgent: fn(),
  onDeleteAgent: async () => undefined,
  compact: false,
  onExpand: fn(),
  onOpenSearch: fn(),
  onOpenMarketplace: fn(),
  pages: storySidebarPages({ usageRows }),
};

/** The sidebar at its width, with the collapse button and the pill pages working. */
function ChatSidebar(props: Parameters<typeof Sidebar>[0]) {
  const [compact, setCompact] = createSignal(props.compact);
  const [current, setCurrent] = createSignal(props.pages?.current ?? "chats");
  const [active, setActive] = createSignal(props.activeAgentId);
  // The open group of the dock is saved with the collapsed sections, as the app does.
  const [collapsed, setCollapsed] = createSignal<string[]>(props.collapsedSectionIds);
  const toggleSection = (sectionId: string) =>
    setCollapsed((current) =>
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId],
    );
  return (
    <div class="app-frame" style={{ width: compact() ? "80px" : "300px", height: "100vh" }}>
      <Sidebar
        {...props}
        compact={compact()}
        activeAgentId={active()}
        onSelectAgent={setActive}
        collapsedSectionIds={collapsed()}
        onToggleSection={toggleSection}
        onExpand={() => setCompact(false)}
        pages={storySidebarPages({
          ...props.pages,
          current: current(),
          onChats: () => setCurrent("chats"),
          onWorkflows: () => setCurrent("workflows"),
          onTasks: () => setCurrent("tasks"),
          onCollapse: () => setCompact(true),
        })}
      />
    </div>
  );
}

const meta = {
  title: "Navigation/Sidebar/Chat list",
  component: Sidebar,
  render: (storyArgs) => <SettledArgs>{() => <ChatSidebar {...storyArgs} />}</SettledArgs>,
  args,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Needs you" on top; "Working", the folders and "Settled" in the dock, with "Working" open. */
export const Open: Story = {};

/** A folder open in the dock, with the folder in it. */
export const FolderOpen: Story = {
  args: { collapsedSectionIds: [`dock:open:${haloRxId}`] },
};

/** No folders: the dock holds "Working" and "Settled". */
export const NoFolders: Story = {
  args: { layout: defaultSidebarLayout() },
};

export const Collapsed: Story = {
  args: { compact: true },
};

export const UpdateNotice: Story = {
  args: { pages: storySidebarPages({ usageRows, settingsNotice: "Update ready" }) },
};

export const NoUsage: Story = {
  args: { pages: storySidebarPages() },
};

export const Empty: Story = {
  args: { agents: [], channels: [], agentStates: {}, agentMoods: {} },
};

/**
 * The dock with Workflows pinned in Customize pill, and a custom agent beside the providers: the stack
 * shows the provider with the least left in front, two small logos behind it, and a count.
 */
export const PinnedPageAndCustomAgent: Story = {
  args: {
    pages: storySidebarPages({
      usageRows,
      pinned: ["workflows"],
      customAgentUsage: [{ id: "agent-hermes", name: "Hermes", text: "Plan: Pro. 61% of the weekly limit left." }],
    }),
  },
};

/* "All machines": the chats of three machines in one list, with a chip per machine. */

const machineAgent = (id: string, name: string, preview: string, minutes: number) => ({
  ...requireFixture(STORY_AGENTS[0], "Story agent"),
  id,
  name,
  title: "",
  threadId: `thread-${id}`,
  avatarSeed: id,
  preview,
  updatedAt: minutesAgo(minutes),
});

const vpsAgents = [
  machineAgent("inbox", "Inbox", "Reply to Renzo today?", 3),
  machineAgent("vps-writer", "Writer", "Drafting the LinkedIn post.", 5),
  machineAgent("uba", "UBA notes", "Week 6 summary is ready.", 40),
  machineAgent("finance", "Finance", "The card bill is paid.", 90),
];

const universityId = "44444444-4444-4444-8444-444444444441";
const vpsLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [{ id: universityId, name: "University" }],
  order: [SIDEBAR_PEOPLE_SECTION_ID, universityId, SIDEBAR_UNASSIGNED_SECTION_ID],
  agentAssignments: { uba: universityId },
  agentOrder: [],
};

const storyMachines: Machine[] = [
  {
    id: "local",
    name: "MacBook",
    logoUrl: null,
    state: "online",
    current: true,
    thisComputer: true,
    agents: { status: "ready", agents: [] },
  },
  {
    id: "personal-vps",
    name: "Personal VPS",
    logoUrl: null,
    state: "online",
    current: false,
    thisComputer: false,
    agents: { status: "ready", agents: [] },
  },
  {
    id: "resorsi-vps",
    name: "Resorsi VPS",
    logoUrl: null,
    state: "offline",
    current: false,
    thisComputer: false,
    agents: { status: "loading" },
  },
];

/** The real sidebar in the "All machines" view, merged the way the app merges it. */
function AllMachinesSidebar(props: { filter?: string | null; compact?: boolean }) {
  const [filter, setFilter] = createSignal<string | null>(props.filter ?? null);
  const merged = () =>
    mergeAllMachinesSidebar({
      activeServerId: "local",
      filter: filter(),
      sources: [
        { serverId: "local", agents, agentStates, agentMoods, layout: folderLayout },
        {
          serverId: "personal-vps",
          agents: vpsAgents,
          agentStates: {
            inbox: { kind: "waiting", reason: "question", detail: "Reply to Renzo today?" },
            "vps-writer": { kind: "working" },
            uba: { kind: "unread", count: 1 },
          },
          agentMoods: { inbox: "waiting", "vps-writer": "working" },
          layout: vpsLayout,
        },
        { serverId: "resorsi-vps", agents: [], agentStates: {}, agentMoods: {}, layout: null },
      ],
    });
  return (
    <ChatSidebar
      {...args}
      serverName="All machines"
      channels={[]}
      compact={props.compact ?? false}
      agents={merged().agents}
      agentStates={merged().agentStates}
      agentMoods={merged().agentMoods}
      layout={merged().layout}
      layoutMutable={false}
      machineChips={{
        machines: storyMachines,
        chosen: filter(),
        attention: merged().attention,
        onChoose: setFilter,
      }}
      allMachines={{
        machines: storyMachines,
        activeServerId: "local",
        filter: filter(),
        onFilterChange: setFilter,
        attention: merged().attention,
        agentServers: merged().agentServers,
        sectionServers: merged().sectionServers,
        onOpenAgent: fn(),
        onRetry: fn(),
        onCreateAgent: fn(),
      }}
    />
  );
}

/** Every machine: "Needs you" on top, then "Working", the folders of each machine and "Settled". */
export const AllMachines: Story = {
  render: () => <SettledArgs>{() => <AllMachinesSidebar />}</SettledArgs>,
};

/** One machine chosen: its chip shows its name, and the rows lose their machine mark. */
export const AllMachinesOneMachine: Story = {
  render: () => <SettledArgs>{() => <AllMachinesSidebar filter="personal-vps" />}</SettledArgs>,
};

/** One machine's own chat list, with the chips over it: the chip of the open machine is chosen. */
export const MachineChipsOnOneMachine: Story = {
  args: {
    machineChips: {
      machines: storyMachines,
      chosen: "local",
      attention: { "personal-vps": "waiting" },
      onChoose: fn(),
    },
  },
};

/** A machine that does not answer shows one muted line with a retry. */
export const AllMachinesOffline: Story = {
  render: () => <SettledArgs>{() => <AllMachinesSidebar filter="resorsi-vps" />}</SettledArgs>,
};

/** The collapsed sidebar shows the faces of the chosen machines. */
export const AllMachinesCollapsed: Story = {
  render: () => <SettledArgs>{() => <AllMachinesSidebar compact />}</SettledArgs>,
};

/* A folder with many agents: the open folder grows into the free room, and scrolls only when the list is full. */

const bigFolderAgents = [
  ["prototype", "Prototype Builder", "No messages yet"],
  ["proto-bot", "Proto Bot", "No messages yet"],
  ["call-center", "Call Center", "No messages yet"],
  ["hackatwin", "HackaTwin", "I'd build Transfer Copilot first."],
  ["coding-worker", "Coding Worker", "No messages yet"],
  ["coding-bot", "Coding Bot", "No messages yet"],
  ["reviewer", "Reviewer", "The pull request is ready."],
].map(([id, name, preview], index) => ({
  ...requireFixture(STORY_AGENTS[index % STORY_AGENTS.length], "Story agent"),
  id,
  name,
  title: "",
  threadId: `thread-${id}`,
  avatarSeed: id,
  preview,
  updatedAt: minutesAgo(index * 5 + 2),
}));

const developmentId = "55555555-5555-4555-8555-555555555551";
const personalId = "55555555-5555-4555-8555-555555555552";
const learningId = "55555555-5555-4555-8555-555555555553";
const bigFolderLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: developmentId, name: "Development & Projects" },
    { id: personalId, name: "Personal & Everyday" },
    { id: learningId, name: "Learning & Research" },
  ],
  order: [SIDEBAR_PEOPLE_SECTION_ID, developmentId, personalId, learningId, SIDEBAR_UNASSIGNED_SECTION_ID],
  agentAssignments: {
    ...Object.fromEntries(bigFolderAgents.map((agent) => [agent.id, developmentId])),
    ...Object.fromEntries(agents.slice(0, 5).map((agent) => [agent.id, personalId])),
    ...Object.fromEntries(agents.slice(5).map((agent) => [agent.id, learningId])),
  },
  agentOrder: [],
};

const bigFolderArgs = {
  agents: [...bigFolderAgents, ...agents],
  agentStates: {},
  agentMoods: {},
  channels: [],
  layout: bigFolderLayout,
  collapsedSectionIds: [`dock:open:${developmentId}`],
};

/** The open folder holds seven agents and shows them all, with the other folders under it. */
export const BigFolderOpen: Story = { args: bigFolderArgs };

/** The same folder under "Needs you": the open folder still takes the room that is left. */
export const BigFolderNeedsYou: Story = {
  args: {
    ...bigFolderArgs,
    agentStates: {
      [thirdId]: { kind: "waiting", reason: "approval", detail: "Post 3 drafts to LinkedIn" },
      scout: { kind: "waiting", reason: "question", detail: "Which month should the report cover?" },
    },
  },
};
