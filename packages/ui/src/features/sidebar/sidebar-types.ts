import type {
  AvatarColor,
  AvatarHue,
  ChannelSummary,
  DirectThreadSummary,
  HiddenAgent,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceMember,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import type { Machine } from "../servers/MachinesPage";
import type { ServerMenuProps } from "../servers/ServerMenu";
import type { ServerMarkServer } from "../servers/ServerRail";
import type { SidebarPages } from "./sidebar-pages";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * What the sidebar is, as data. These live apart from `Sidebar.tsx` because
 * nine of this feature's modules - the drag engine, the filtering, the scope
 * and every store - name one of these types and none of them render anything.
 * Reading them from the entry component made the pure logic depend on the whole
 * view to borrow a name.
 */
/**
 * What the main area shows for the chat picked in the list: its conversation, or its routines. The
 * list itself is the same in both.
 */
export type SidebarView = "agents" | "routines";

/**
 * The "Hidden" group is not a section of the layout, and it is collapsed by default. Its id in
 * `collapsedSectionIds` therefore records that the user opened it, not that the user collapsed it.
 * The colon keeps it apart from the section ids that the layout makes.
 */
export const SIDEBAR_HIDDEN_GROUP_OPEN_ID = "hidden-agents:open";

/**
 * The lists of the thread lanes are not sections of the layout either. Their ids in
 * `collapsedSectionIds` record that the user collapsed them. The colon keeps them apart from the
 * section ids that the layout makes.
 */
export const SIDEBAR_LANE_IDS = {
  waiting: "lanes:waiting",
  working: "lanes:working",
  agents: "lanes:agents",
  channels: "lanes:channels",
} as const;

/**
 * The dock of the chat sidebar opens one group at a time. The open group is saved in
 * `collapsedSectionIds` as `dock:open:<group id>`, and `dock:none` records that the user closed all
 * of them. With neither, "Working" is open. A folder group's id is its section id, and "Settled" is
 * the unassigned section. The colon keeps these ids apart from the section ids that the layout makes.
 */
export const SIDEBAR_DOCK_OPEN_PREFIX = "dock:open:";
export const SIDEBAR_DOCK_NONE_ID = "dock:none";
/** The "Working" group of the dock. */
export const SIDEBAR_DOCK_WORKING_ID = "dock:working";

/**
 * How the list orders the chats in the sections. Pins and "Needs you" come first in each order, and
 * none of them changes the saved `agentOrder`.
 * - `manual`: the saved order of the layout.
 * - `unread-group`: unread chats leave their section for an "Unread" group under "Needs you", and go
 *   back to their place when they are read.
 * - `unread-first`: each section shows its unread chats first, then the others, both by last
 *   activity. Chats do not drag in this order, because the order is not manual.
 */
export type SidebarChatOrder = "manual" | "unread-group" | "unread-first";

export const SIDEBAR_CHAT_ORDERS = [
  "manual",
  "unread-group",
  "unread-first",
] as const satisfies readonly SidebarChatOrder[];

/** The name of each order, in the sidebar menu and in Settings. */
export const SIDEBAR_CHAT_ORDER_LABEL = {
  manual: "sidebar.order.manual",
  "unread-group": "sidebar.order.unreadGroup",
  "unread-first": "sidebar.order.unreadFirst",
} as const satisfies Record<SidebarChatOrder, AppTextKey>;

/** Where an agent row of the "All machines" view lives: its server, and the agent's own id there. */
export interface SidebarMachineAgentRef {
  serverId: string;
  agentId: string;
}

/** What a machine of the "All machines" view holds for the user: a chat that waits, or one that is unread. */
export type SidebarMachineAttention = "waiting" | "unread";

/**
 * The "All machines" view of the chat sidebar: the chats of every server in one list, with "Needs you"
 * on top and "Working", the folders and "Settled" in the dock, and a row of chips that shows one
 * machine or all of them. The caller merges the agents, their states and the folders of the chosen
 * machines into `agents`, `agentStates`, `agentMoods` and `layout`. Channels, pins and people belong
 * to one server, so the view has none of them.
 */
/**
 * The machine chips over the chat list: "All", then one chip per machine. They show in every view
 * while the user has more than one machine: "All" opens the "All machines" view, and a machine opens
 * that machine's own chat list.
 */
export interface SidebarMachineChipsProps {
  /** The machines in the order of the server menu. */
  machines: readonly Machine[];
  /** The chosen chip: a machine id, or null for "All". */
  chosen: string | null;
  /** What each machine holds for the user, for the chip's dot. A machine with nothing has no entry. */
  attention: Readonly<Record<string, SidebarMachineAttention>>;
  onChoose: (serverId: string | null) => void;
}

export interface SidebarAllMachines {
  /** The servers in the order of the server menu, for the chips and the notices. */
  machines: readonly Machine[];
  /** The server that the window has open. Its agents show with their full rows and menus. */
  activeServerId: string;
  /** The machine that the list shows, or null for all of them. */
  filter: string | null;
  onFilterChange: (serverId: string | null) => void;
  /** What each machine holds for the user. A machine with nothing has no entry. */
  attention: Readonly<Record<string, SidebarMachineAttention>>;
  /** The server and own id of each agent row, by row id. */
  agentServers: ReadonlyMap<string, SidebarMachineAgentRef>;
  /** The server of each folder, by folder id. */
  sectionServers: ReadonlyMap<string, string>;
  /** Opens the chat of an agent on its server, and switches to that server first when needed. */
  onOpenAgent: (serverId: string, agentId: string) => void;
  /** Connects to a server again, or reads its agents again. */
  onRetry: (serverId: string) => void;
  /** Opens the new agent form of a server. New asks for the server, as no server is the one open in the view. */
  onCreateAgent: (serverId: string) => void;
}

export interface SidebarProps {
  /** The switch over the list is shown only when the caller handles `onViewChange`. */
  view?: SidebarView | undefined;
  onViewChange?: ((view: SidebarView) => void) | undefined;
  deleteSupported?: boolean | undefined;
  marketplaceSupported?: boolean | undefined;
  channels?: ChannelSummary[] | undefined;
  deletedChannels?: ChannelSummary[] | undefined;
  activeChannelId?: string | null | undefined;
  onSelectChannel?: ((channelId: string) => void) | undefined;
  showingArchivedChannels?: boolean | undefined;
  onToggleArchivedChannels?: (() => void) | undefined;
  onCreateChannel?: (() => void) | undefined;
  /** Marks every agent chat and channel read. The free-area menu offers it while `hasUnread` is set. */
  onMarkAllRead?: (() => void) | undefined;
  hasUnread?: boolean | undefined;
  onEditChannel?: ((channelId: string) => void) | undefined;
  onDeleteChannel?: ((channelId: string) => Promise<void>) | undefined;
  /** Brings a deleted channel back to the list. Without it, a row in Deleted channels has no menu. */
  onRestoreChannel?: ((channelId: string) => void) | undefined;
  serverName: string;
  /**
   * The server of the chats, as a small mark at the end of each row, with its name on hover. Set it
   * only while the user has more than one server, where the mark tells them apart.
   */
  chatServer?: (ServerMarkServer & { name: string }) | undefined;
  /** The "All machines" view. With it, the chat list shows the agents of every server, with machine chips. */
  /** The machine chips over the chat list. Set while the user has more than one machine. */
  machineChips?: SidebarMachineChipsProps | undefined;
  allMachines?: SidebarAllMachines | undefined;
  onOpenServerSettings?: ((trigger: HTMLElement) => void) | undefined;
  /** The desktop server menu. Without it, the server name opens the server settings. */
  serverMenu?: Omit<ServerMenuProps, "serverName" | "compact"> | undefined;
  /**
   * Back and Forward between the chats this window opened. The top bar shows the two arrows only when
   * it is set. `back` and `forward` name the chat that each arrow opens, or are null when there is none.
   */
  chatHistory?: SidebarChatHistory | undefined;
  /** A new OpenBot version of the server. The header shows a button that opens its update. */
  serverUpdate?: { version: string; running: boolean; onOpen: () => void } | undefined;
  agents: AgentProfile[];
  activeAgentId: string;
  showPeople?: boolean | undefined;
  people: TeamPresenceMember[];
  directThreads: DirectThreadSummary[];
  activeDirectMemberId: string | null;
  agentStates: Record<string, SidebarAgentState>;
  /** The wait of each channel that waits for the user, from `sidebarChannelWaits`. A missing entry does not wait. */
  channelWaits?: Record<string, SidebarChannelWait> | undefined;
  /** The channel rows come from a saved frame, which holds no last message. A row with none shows no preview and no time. */
  channelPreviewsPending?: boolean | undefined;
  /** The face each agent wears, from `computeAgentAvatarMoods`. A missing entry rests. */
  agentMoods: Record<string, AvatarMood>;
  layout: SidebarLayoutSnapshot;
  layoutMutable?: boolean | undefined;
  /** How the list orders the chats. The default is `manual`. */
  chatOrder?: SidebarChatOrder | undefined;
  /** Saves the user's choice of order. Without it, the list menu has no "Sort chats" item. */
  onChatOrderChange?: ((order: SidebarChatOrder) => void) | undefined;
  collapsedSectionIds: string[];
  onMutateLayout: (action: SidebarLayoutAction) => Promise<void>;
  /**
   * Whether this server keeps folders in folders (`sidebar-folders-v1`). Without it, a folder cannot go
   * into another folder, and the menu has no items to put it there.
   */
  foldersSupported?: boolean | undefined;
  /** Whether this server can copy a section with its agents. Without it, the section menu has no duplicate item. */
  sectionDuplicateSupported?: boolean | undefined;
  duplicatingSectionIds?: ReadonlySet<string> | undefined;
  onDuplicateSection?: ((sectionId: string) => Promise<void>) | undefined;
  onToggleSection: (sectionId: string) => void;
  pinnedItems: SidebarPinnedItem[];
  peopleOrder: string[];
  onPin: (item: SidebarPinnedItem) => void;
  onUnpin: (item: SidebarPinnedItem) => void;
  onReorderPinned: (items: SidebarPinnedItem[]) => void;
  onReorderPeople: (memberIds: string[]) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPerson: (memberId: string) => void;
  onPreloadDirectConversation?: (() => void) | undefined;
  /** Whether this server currently accepts new agents. Desktop keeps the default enabled. */
  createSupported?: boolean | undefined;
  onCreateAgent: () => void;
  onEditAgent: (agentId: string) => void;
  duplicateSupported?: boolean | undefined;
  duplicatingAgentIds?: ReadonlySet<string> | undefined;
  onDuplicateAgent?: ((agentId: string) => Promise<void>) | undefined;
  onDeleteAgent: (agentId: string) => Promise<void>;
  /**
   * The agents that a user hid on this server (`agent-hidden-v1`). They leave their sections, the
   * pinned strip and "Needs you", and show only in the "Hidden" group at the end of the list. Each
   * one keeps its section and its pin for a restore.
   */
  userHiddenAgents?: HiddenAgent[] | undefined;
  /**
   * The agents whose own chat or side threads have unread replies. Their menu offers Mark read; the
   * menu of the other agents offers Mark unread.
   */
  unreadAgentIds?: ReadonlySet<string> | undefined;
  /** Marks the chat and the side threads of an agent read. Without it, the agent menu shows no read item. */
  onMarkAgentRead?: ((agentId: string) => void) | undefined;
  /** Marks the newest reply of an agent unread. Without it, the agent menu shows no unread item. */
  onMarkAgentUnread?: ((agentId: string) => void) | undefined;
  /** Hides an agent. Without it, the agent menu shows no hide item. */
  onHideAgent?: ((agentId: string) => void) | undefined;
  /** Puts a hidden agent back in its section. Without it, a hidden agent's menu shows no restore item. */
  onRestoreAgent?: ((agentId: string) => void) | undefined;
  /** Opens the agent's chat with a new thread. Without it, such as on a host without threads, the agent menu shows no new thread item. */
  onNewAgentThread?: ((agentId: string) => void) | undefined;
  /** Opens the agent's chat in a window of its own. Without it, the agent menu shows no window item. */
  onOpenAgentWindow?: ((agentId: string) => void) | undefined;
  /** The agents whose chat is open in a window of its own. Their rows show a window mark. */
  windowAgentIds?: ReadonlySet<string> | undefined;
  compact: boolean;
  /**
   * The pages, the provider usage and the account switch. With them, the sidebar is the chat sidebar:
   * one list by last message, with the pages in a pill at the bottom, and a face dock when compact.
   * Without them, it is the list of sections that the page rail went with.
   */
  pages?: SidebarPages | undefined;
  /** A card under the chat list, such as an announcement. The compact sidebar has no room for it. */
  footer?: JSX.Element;
  onExpand: () => void;
  /** Opens the global search. The search field and the compact search button both call it. */
  onOpenSearch: () => void;
  onOpenMarketplace: () => void;
  /** The agents are still on their way, so an empty list says that it connects rather than that it is empty. */
  agentsConnecting?: boolean | undefined;
  /**
   * The thread lanes: "Needs you" and "Working" list each thread of each agent, and "Agents" lists each
   * agent once. Without it, the list shows the sections of the layout, as before.
   */
  threadLanes?: SidebarThreadLanes | undefined;
  emptyAction?:
    | {
        label: string;
        avatarSeed: string;
        avatarHue: AvatarHue | null;
        avatarColor: AvatarColor | null;
        onSelect: () => void;
      }
    | undefined;
}

export interface SidebarChatHistory {
  back: { name: string } | null;
  forward: { name: string } | null;
  /** The keys of each arrow, as the tooltip shows them, such as "⌘[". */
  keys: { back: string; forward: string };
  onBack: () => void;
  onForward: () => void;
}

export type SidebarRoutinePhase = "running" | "queued" | "failed";

/** What an agent waits for: an answer to its question, an approval, or the user in the browser. */
export type SidebarWaitReason = "question" | "approval" | "takeover";

export type SidebarAgentState =
  /** `detail` is the question or the command, for the row tooltip. `null` when there is none. */
  | { kind: "waiting"; reason: SidebarWaitReason; detail: string | null }
  | { kind: "working" }
  | { kind: "responded" }
  /** `count` is the unread replies of the agent's chat. 0: only its side threads have unread replies. */
  | { kind: "unread"; count: number }
  | { kind: "routine"; phase: SidebarRoutinePhase; count: number }
  /** The provider plan is spent, so the queue waits. `resetsAt` is in epoch seconds, `null` when unknown. */
  | { kind: "limited"; resetsAt: number | null };

/** What a channel waits for. Its row shows it in "Needs you" the same way an agent row does. */
export type SidebarChannelWait = Extract<SidebarAgentState, { kind: "waiting" }>;

/** A pin paired with the chat it names, so the pinned strip renders the same two kinds the list does. */
export type ResolvedPinnedItem = { ref: SidebarPinnedItem; chat: SidebarChatItem };

/**
 * A row inside a section. Agents and channels share the sidebar layout - one order, one set of
 * section assignments - so the list, the grouping and the drag pipeline carry them as one type and
 * only the row component asks which kind it has.
 */
export type SidebarChatItem =
  | { kind: "agent"; id: string; agent: AgentProfile }
  | { kind: "channel"; id: string; channel: ChannelSummary };

/** A thread that needs the user or works. A thread with any other state is not in the lanes. */
export interface SidebarThreadEntry {
  agentId: string;
  /** `main` for the agent's own chat, else the id of the side thread. */
  threadId: string;
  /** The title of the side thread. Null for the agent's own chat. */
  title: string | null;
  state: Extract<SidebarAgentState, { kind: "waiting" | "working" }>;
  /** The last change of the thread, as an ISO time. Null when unknown. */
  updatedAt: string | null;
}

export interface SidebarThreadLanes {
  threads: readonly SidebarThreadEntry[];
  /** The thread on screen, from `threadTabKey`. Null while no agent chat is on screen. */
  activeKey: string | null;
  /** The agents whose own chat has a reply that the user did not read. */
  unreadAgentIds: ReadonlySet<string>;
  /** Shows the agent's chat with the thread open. */
  onOpenThread: (agentId: string, threadId: string) => void;
}
