import {
  type Channel,
  type ChannelSummary,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type HiddenAgent,
  isChannel,
  isClientAgentModelOption,
  isClientAgentSummary,
  isHiddenAgent,
  isSidebarLayoutSnapshot,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type FrameStorage, frameKey, savedChannelRows, savedUnreadCounts } from "./remote-workspace-frame-keys";

export { deleteRemoteWorkspaceFrame, deleteRemoteWorkspaceFrames } from "./remote-workspace-frame-keys";

/**
 * The frame of a joined server's workspace from its last load: the agents, their sidebar layout and
 * the models. A client shows it while it connects again, read-only, and the next load replaces it.
 * It holds no message text: the last message of each agent (`preview`) is removed before the write,
 * and a channel keeps only its row: no last message, no instructions, no counts. An agent keeps its
 * unread count, so the sidebar "Unread" group does not reorder the rows when the host answers.
 * The frame is of one account and one server, and it is deleted on sign-out, when the server leaves
 * the list, and when the host ends access.
 */
export interface RemoteWorkspaceFrame {
  agents: ClientAgentSummary[];
  models: ClientAgentModelOption[];
  sidebarLayout: SidebarLayoutSnapshot | null;
  hiddenAgents: HiddenAgent[];
  /** The channel rows of the sidebar, so the agents below them do not move when the list comes. */
  channels: ChannelSummary[];
  /** The agent that was open, on the web. The desktop app keeps its own selection. */
  selectedAgentId: string | null;
  /** The agents opened last on the web, the newest first. A new page reads their latest page early. */
  recentAgentIds: string[];
  /** The unread count of each agent chat that has unread messages. */
  unreadCounts: Record<string, number>;
}

/** The agents that `recentAgentIds` keeps: the open one and the 3 before it. */
const RECENT_AGENTS = 4;
/** An older frame shows a workspace that has changed too much to be useful. */
const FRAME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A channel row with no text but its name and title. */
function frameChannel(channel: Channel): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    title: channel.title,
    instructions: "",
    members: channel.members.map((member) => ({ agentId: member.agentId })),
    leadAgentId: channel.leadAgentId,
    archived: channel.archived,
    revision: channel.revision,
    createdAt: channel.createdAt,
    unreadCount: 0,
    activeTasks: 0,
    lastMessage: null,
  };
}

function decodeFrame(frame: unknown): RemoteWorkspaceFrame | null {
  if (!isDynamicRecord(frame) || !isNumber(frame.savedAt) || Date.now() - frame.savedAt > FRAME_MAX_AGE_MS) return null;
  if (!Array.isArray(frame.agents) || !frame.agents.every(isClientAgentSummary)) return null;
  return {
    agents: frame.agents,
    models: Array.isArray(frame.models) ? frame.models.filter(isClientAgentModelOption) : [],
    sidebarLayout: isSidebarLayoutSnapshot(frame.sidebarLayout) ? frame.sidebarLayout : null,
    hiddenAgents: Array.isArray(frame.hiddenAgents) ? frame.hiddenAgents.filter(isHiddenAgent) : [],
    channels: Array.isArray(frame.channels) ? frame.channels.filter(isChannel).map(frameChannel) : [],
    selectedAgentId: isString(frame.selectedAgentId) ? frame.selectedAgentId : null,
    recentAgentIds: Array.isArray(frame.recentAgentIds) ? frame.recentAgentIds.filter(isString) : [],
    unreadCounts: unreadCounts(frame.unreadCounts),
  };
}

/** The positive counts of a record. A frame from an older version has none. */
function unreadCounts(counts: unknown): Record<string, number> {
  if (!isDynamicRecord(counts)) return {};
  return Object.fromEntries(
    Object.entries(counts).flatMap(([agentId, count]) => (isNumber(count) && count > 0 ? [[agentId, count]] : [])),
  );
}

/** The saved frame, or null when there is none, when it is too old, or when it does not decode. */
export function readRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  storage: FrameStorage = window.localStorage,
): RemoteWorkspaceFrame | null {
  try {
    const raw = storage.getItem(frameKey(accountId, serverId));
    return raw ? decodeFrame(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Writes the given parts over the saved frame. The reads of a load answer in any order, so a layout
 * can come before the agents. A frame with no agents is not shown.
 */
export function saveRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  // The recent agents follow `selectedAgentId`, so a caller does not write them.
  update: Partial<Omit<RemoteWorkspaceFrame, "recentAgentIds">>,
  storage: FrameStorage = window.localStorage,
): void {
  const current = readRemoteWorkspaceFrame(accountId, serverId, storage);
  const agents = update.agents ?? current?.agents ?? [];
  const recent = current?.recentAgentIds ?? [];
  const selected = update.selectedAgentId;
  const frame = {
    savedAt: Date.now(),
    agents: agents.map((agent) => ({ ...agent, preview: "" })),
    models: update.models ?? current?.models ?? [],
    sidebarLayout: update.sidebarLayout ?? current?.sidebarLayout ?? null,
    hiddenAgents: update.hiddenAgents ?? current?.hiddenAgents ?? [],
    channels: (update.channels ?? current?.channels ?? []).map(frameChannel),
    selectedAgentId: update.selectedAgentId !== undefined ? update.selectedAgentId : (current?.selectedAgentId ?? null),
    recentAgentIds: selected ? [selected, ...recent.filter((id) => id !== selected)].slice(0, RECENT_AGENTS) : recent,
    unreadCounts: unreadCounts(update.unreadCounts ?? current?.unreadCounts ?? {}),
  };
  try {
    storage.setItem(frameKey(accountId, serverId), JSON.stringify(frame));
  } catch {
    // A full or blocked storage only costs the frame. The workspace still loads from the host.
  }
}

/** Writes the channel rows of a list to the frame when they changed since the last write. */
export function saveRemoteFrameChannels(
  accountId: string,
  serverId: string,
  channels: readonly ChannelSummary[],
): void {
  const rows = channels.map(frameChannel);
  const key = frameKey(accountId, serverId);
  const value = JSON.stringify(rows);
  if (savedChannelRows.get(key) === value) return;
  savedChannelRows.set(key, value);
  saveRemoteWorkspaceFrame(accountId, serverId, { channels: rows });
}

/** Writes the unread counts of the agents to the frame when they changed since the last write. */
export function saveRemoteFrameUnreadCounts(
  accountId: string,
  serverId: string,
  counts: Readonly<Record<string, number>>,
): void {
  const key = frameKey(accountId, serverId);
  const value = JSON.stringify(counts);
  if (savedUnreadCounts.get(key) === value) return;
  savedUnreadCounts.set(key, value);
  saveRemoteWorkspaceFrame(accountId, serverId, { unreadCounts: { ...counts } });
}
