import {
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
  type SidebarSection,
} from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import type { AgentProfile } from "@openbot/ui/data";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type {
  SidebarAgentState,
  SidebarMachineAgentRef,
  SidebarMachineAttention,
} from "@openbot/ui/features/sidebar/sidebar-types";
import type { MachineActivity } from "./machine-activity";

/** The chats and folders of one server, as the "All machines" view merges them. */
export interface AllMachinesSource {
  serverId: string;
  /** The agents of the server, without the hidden ones, with their own ids. */
  agents: readonly AgentProfile[];
  agentStates: Readonly<Record<string, SidebarAgentState>>;
  agentMoods: Readonly<Record<string, AvatarMood>>;
  layout: SidebarLayoutSnapshot | null;
  /** A side thread of an agent waits for the user. The agent's own state does not show it. */
  threadWaits?: boolean | undefined;
}

/** What the sidebar shows in the "All machines" view: the chats of the chosen machines as one list. */
export interface AllMachinesSidebar {
  agents: AgentProfile[];
  agentStates: Record<string, SidebarAgentState>;
  agentMoods: Record<string, AvatarMood>;
  layout: SidebarLayoutSnapshot;
  agentServers: Map<string, SidebarMachineAgentRef>;
  sectionServers: Map<string, string>;
  /** What each machine holds for the user, also a machine that the filter hides. */
  attention: Record<string, SidebarMachineAttention>;
}

/**
 * The id of a row or a folder of another server in the merged list. Two servers can have an agent or
 * a folder with the same id, as a server copied from another does, so each id names its server.
 */
function scopedId(serverId: string, id: string): string {
  return `machine:${serverId}:${id}`;
}

/**
 * The states and the faces of the agents of a server that the window does not have open, from what
 * the server reported: its turns, queues, questions and approvals, and its unread counts.
 */
export function machineAgentActivity(input: {
  agentIds: readonly string[];
  activity: MachineActivity | null;
  unreadReplies: Readonly<Record<string, number>>;
}): { agentStates: Record<string, SidebarAgentState>; agentMoods: Record<string, AvatarMood> } {
  const activity = input.activity;
  const common = {
    agentIds: input.agentIds,
    activeTurns: activity?.activeTurns ?? {},
    queues: activity?.queues ?? {},
    failedTurns: activity?.failedTurns ?? {},
    pendingPrompts: activity?.pendingPrompts ?? {},
    pendingApprovals: activity?.pendingApprovals ?? {},
    recentReplies: {},
  };
  return {
    agentStates: computeSidebarAgentStates({ ...common, unreadReplies: { ...input.unreadReplies } }),
    agentMoods: computeAgentAvatarMoods(common),
  };
}

function machineAttention(source: AllMachinesSource): SidebarMachineAttention | undefined {
  const states = Object.values(source.agentStates);
  if (source.threadWaits || states.some((state) => state.kind === "waiting")) return "waiting";
  return states.some((state) => state.kind === "unread") ? "unread" : undefined;
}

/**
 * Merges the servers of the "All machines" view into the props of one sidebar. The agents of the open
 * server keep their own ids, so their rows keep their menus, their unread marks and their threads;
 * the agents of the other servers get an id that names their server. Each server keeps its own
 * folders, in the order of the server menu; the agents in no folder of any server are in "Settled".
 *
 * `filter` keeps one server, or every server when it is null. The attention of each machine counts
 * every server, so a chip shows its dot while the filter hides that machine.
 */
export function mergeAllMachinesSidebar(input: {
  sources: readonly AllMachinesSource[];
  activeServerId: string;
  filter: string | null;
}): AllMachinesSidebar {
  const result: AllMachinesSidebar = {
    agents: [],
    agentStates: {},
    agentMoods: {},
    layout: { revision: 0, sections: [], order: [], agentAssignments: {}, agentOrder: [] },
    agentServers: new Map(),
    sectionServers: new Map(),
    attention: {},
  };
  const folderOrder: string[] = [];
  for (const source of input.sources) {
    const attention = machineAttention(source);
    if (attention) result.attention[source.serverId] = attention;
    if (input.filter !== null && input.filter !== source.serverId) continue;
    const own = source.serverId === input.activeServerId;
    const rowId = (agentId: string) => (own ? agentId : scopedId(source.serverId, agentId));
    for (const agent of source.agents) {
      const id = rowId(agent.id);
      result.agents.push(own ? agent : { ...agent, id });
      result.agentServers.set(id, { serverId: source.serverId, agentId: agent.id });
      const state = source.agentStates[agent.id];
      if (state) result.agentStates[id] = state;
      const mood = source.agentMoods[agent.id];
      if (mood) result.agentMoods[id] = mood;
    }
    const layout = source.layout;
    if (!layout) continue;
    // The folders of a server, by their ids in the merged list. The people and "Settled" are shared.
    const folders = new Map<string, string>(
      layout.sections.map((section) => [section.id, scopedId(source.serverId, section.id)]),
    );
    for (const section of layout.sections) {
      const id = folders.get(section.id) ?? section.id;
      const parentId = section.parentId === undefined ? undefined : folders.get(section.parentId);
      const merged: SidebarSection =
        parentId === undefined ? { id, name: section.name } : { id, name: section.name, parentId };
      result.layout.sections.push(merged);
      result.sectionServers.set(id, source.serverId);
    }
    for (const sectionId of layout.order) {
      const id = folders.get(sectionId);
      if (id) folderOrder.push(id);
    }
    for (const [agentId, sectionId] of Object.entries(layout.agentAssignments)) {
      const id = folders.get(sectionId);
      if (id) result.layout.agentAssignments[rowId(agentId)] = id;
    }
    result.layout.agentOrder.push(...layout.agentOrder.map(rowId));
  }
  result.layout.order = [SIDEBAR_PEOPLE_SECTION_ID, ...folderOrder, SIDEBAR_UNASSIGNED_SECTION_ID];
  return result;
}
