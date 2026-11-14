import { MAIN_THREAD_ID } from "../conversation/threads/thread-types";
import type { SidebarAgentState, SidebarChatItem, SidebarThreadEntry } from "./sidebar-types";

/** An ISO time as milliseconds, or 0 when it is absent or not a time. */
function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : at;
}

/** The last change of each agent's side threads, by agent id. */
function threadTimesOf(threads: readonly SidebarThreadEntry[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const entry of threads) {
    times.set(entry.agentId, Math.max(times.get(entry.agentId) ?? 0, timeOf(entry.updatedAt)));
  }
  return times;
}

/** The last activity of a chat: an agent's last message or thread change, a channel's last message. */
function chatTime(item: SidebarChatItem, threadTimes: ReadonlyMap<string, number>): number {
  return item.kind === "agent"
    ? Math.max(timeOf(item.agent.updatedAt), threadTimes.get(item.id) ?? 0)
    : timeOf(item.channel.lastMessage?.at ?? item.channel.createdAt);
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
  const threadTimes = threadTimesOf(threads);
  const timed = chats.map((item, index) => ({ item, index, at: chatTime(item, threadTimes) }));
  return timed.sort((left, right) => right.at - left.at || left.index - right.index).map((entry) => entry.item);
}

/** A finished agent stays in "Working" for 6 hours after its last activity. */
export const SIDEBAR_DONE_KEEP_MS = 6 * 60 * 60_000;
/** "Working" shows at most 5 finished agents. */
export const SIDEBAR_DONE_MAX = 5;

/** An agent that finished recently, and the time of its last activity in milliseconds. */
export interface SidebarDoneChat {
  chat: SidebarChatItem;
  doneAt: number;
}

/**
 * The agents that finished recently, newest first: those of `candidates` (the agents that neither
 * work nor wait) whose last activity is less than 6 hours before `now`, at most 5. It reads only the
 * last activity of the agent and its threads, so it is the same after a restart and on a joined server.
 */
export function sidebarRecentlyDone(
  candidates: readonly SidebarChatItem[],
  threads: readonly SidebarThreadEntry[],
  now: number,
): SidebarDoneChat[] {
  const threadTimes = threadTimesOf(threads);
  return candidates
    .flatMap((chat) => {
      if (chat.kind !== "agent") return [];
      const doneAt = chatTime(chat, threadTimes);
      return doneAt > 0 && now - doneAt < SIDEBAR_DONE_KEEP_MS ? [{ chat, doneAt }] : [];
    })
    .sort((left, right) => right.doneAt - left.doneAt)
    .slice(0, SIDEBAR_DONE_MAX);
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
