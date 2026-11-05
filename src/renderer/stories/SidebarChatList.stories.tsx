import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { STORY_AGENTS, STORY_SERVERS } from "./fixtures";
import { SettledArgs } from "./settled-args";
import { storySidebarPages } from "./sidebar-pages-story";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Each agent with a last message and its time, so the list sorts by recency. */
const agents = STORY_AGENTS.map((agent, index) => ({
  ...agent,
  preview:
    [
      "Your biggest opportunity is the pricing page.",
      "Both MP4 files are in the folder.",
      "I opened the hero in the preview so you can compare both versions.",
    ][index % 3] ?? agent.preview,
  updatedAt: minutesAgo(index * 7 + 1),
}));

const firstId = agents[0]?.id ?? "";
const secondId = agents[1]?.id ?? "";
const thirdId = agents[2]?.id ?? "";

const agentStates: Record<string, SidebarAgentState> = {
  [secondId]: { kind: "working" },
  [thirdId]: { kind: "waiting", reason: "approval", detail: "Post 3 drafts to LinkedIn" },
  [firstId]: { kind: "unread", count: 2 },
};

const agentMoods: Record<string, AvatarMood> = {
  [secondId]: "working",
  [thirdId]: "waiting",
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
  layout: defaultSidebarLayout(),
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
  return (
    <div class="app-frame" style={{ width: compact() ? "80px" : "300px", height: "100vh" }}>
      <Sidebar
        {...props}
        compact={compact()}
        activeAgentId={active()}
        onSelectAgent={setActive}
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

export const Open: Story = {};

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
