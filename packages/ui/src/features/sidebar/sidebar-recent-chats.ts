import { MAIN_THREAD_ID } from "../conversation/threads/thread-types";
import type { SidebarAgentState, SidebarChatItem, SidebarThreadEntry } from "./sidebar-types";

/** An ISO time as milliseconds, or 0 when it is absent or not a time. */
function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : at;
}

/**
 * The chats of the chat list, newest first: an agent by its last message or the last change of one
 * of its threads, a channel by its last message. Chats with the same time keep the order of the
 * layout, so the list does not jump while nothing changes.
 */
export function sidebarRecentChats(
  chats: readonly SidebarChatItem[],
  threads: readonly SidebarThreadEntry[] = [],
): SidebarChatItem[] {
  const threadTimes = new Map<string, number>();
  for (const entry of threads) {
    threadTimes.set(entry.agentId, Math.max(threadTimes.get(entry.agentId) ?? 0, timeOf(entry.updatedAt)));
  }
  const timed = chats.map((item, index) => ({
    item,
    index,
    at:
      item.kind === "agent"
        ? Math.max(timeOf(item.agent.updatedAt), threadTimes.get(item.id) ?? 0)
        : timeOf(item.channel.lastMessage?.at ?? item.channel.createdAt),
  }));
  return timed.sort((left, right) => right.at - left.at || left.index - right.index).map((entry) => entry.item);
}

/** What an agent waits for, and the thread that the user answers it in. */
export interface SidebarAgentWait {
  state: Extract<SidebarAgentState, { kind: "waiting" }>;
  threadId: string;
}

/**
 * The wait of an agent: the wait of its own chat, else the first side thread that waits. A row shows
 * it in place of the last message, and a click opens that thread.
 */
export function sidebarAgentWait(
  agentId: string,
  state: SidebarAgentState | undefined,
  threads: readonly SidebarThreadEntry[] = [],
): SidebarAgentWait | undefined {
  if (state?.kind === "waiting") return { state, threadId: MAIN_THREAD_ID };
  const entry = threads.find((thread) => thread.agentId === agentId && thread.state.kind === "waiting");
  return entry?.state.kind === "waiting" ? { state: entry.state, threadId: entry.threadId } : undefined;
}
