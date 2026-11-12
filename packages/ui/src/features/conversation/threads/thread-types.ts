import type { AgentProfile } from "@openbot/ui/data";
import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";

/** What the agent does in a thread, as a sidebar row shows it for the agent. */
export type ThreadStatus =
  | { kind: "idle" }
  | { kind: "working" }
  /** A message waits for a free turn. */
  | { kind: "queued" }
  | { kind: "waiting"; reason: SidebarWaitReason }
  | { kind: "failed" };

/**
 * One side thread of an agent. `draft` is a new thread that has no message yet: its first message
 * starts it. The agent's own chat is not a thread item: the agent's name in the header opens it.
 */
export interface ThreadItem {
  id: string;
  /** `main` is the agent's own chat. It is a tab only in the tabs of all agents. */
  kind: "main" | "side" | "draft";
  title: string;
  updatedAt: string;
  status: ThreadStatus;
  /** The agent messages in the thread that the user has not read. Absent when the host keeps no read mark. */
  unread?: number | undefined;
  /**
   * The tree lines before the title in the thread menu, for a branch under its source thread. Absent
   * at the top level and in the tabs.
   */
  stem?: ThreadStem | undefined;
  /** The agent of the thread, in the tabs of all agents. Absent in the tabs of one agent. */
  agent?: ThreadItemAgent | undefined;
}

/** The face and the copy word of the agent of a tab. */
export interface ThreadItemAgent {
  profile: AgentProfile;
  /** The role title of a copy of an agent: two or more agents have its name and face. Null otherwise. */
  copy: string | null;
  /** The agent's chat is on screen, so its side panel can take the thread. */
  onScreen: boolean;
}

/**
 * The tree lines of a branch. `through` has one entry for each outer level, true where the line of
 * that level continues to a later thread. `last` ends the line of this level at this branch.
 */
export interface ThreadStem {
  through: readonly boolean[];
  last: boolean;
}

/** The thread row as tabs, as one button with the open thread, or as a chevron only. */
export type ThreadRowMode = "tabs" | "compact" | "minimal";

/** A turn runs in the thread. The user stops it before an archive or a delete. */
export function threadBusy(status: ThreadStatus): boolean {
  return status.kind === "working" || status.kind === "waiting";
}

/**
 * The threads of one agent and what the user can do with them. `onRename` and `onDelete` are missing
 * when the host cannot rename or delete threads; the actions then do not show.
 */
export interface ThreadHeaderProps {
  /** Every side thread that is not archived. The agent's name in the header opens the agent's own chat. */
  threads: readonly ThreadItem[];
  /** The side threads that have a tab, and the new thread, in tab order. */
  tabs: readonly ThreadItem[];
  archived: readonly ThreadItem[];
  activeId: string;
  /** False at the limit of threads. */
  canStartNew: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToTheRight: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onArchive: (id: string) => void;
  /**
   * Stops the running turn of a side thread and cancels its queued messages. The thread stays open.
   * Missing when the host cannot stop a thread.
   */
  onStop?: ((id: string) => void) | undefined;
  /** Restores an archived thread and opens it. */
  onRestore: (id: string) => void;
  onRename?: ((id: string, title: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  /** Opens a side thread in the side panel. Missing when the chat has no side panel. */
  onMoveToSide?: ((id: string) => void) | undefined;
  /**
   * The tabs are the tabs of all agents: each one names its agent, the agent's own chat has a tab, and
   * the agent's name does not show before them.
   */
  allAgents?: boolean | undefined;
}

/** The id of the agent's own chat in the thread lists. A side thread has the id of its task. */
export const MAIN_THREAD_ID = "main";
/** The id of the new thread tab, before its first message starts the thread. */
export const DRAFT_THREAD_ID = "draft";

/**
 * The id of a tab in the tabs of all agents: the agent and its thread. Agent ids have no slash: they
 * name folders.
 */
export function threadTabKey(agentId: string, threadId: string): string {
  return `${agentId}/${threadId}`;
}

/** The agent and thread of a key from `threadTabKey`. */
export function parseThreadTabKey(key: string): { agentId: string; threadId: string } | null {
  const at = key.indexOf("/");
  return at <= 0 || at === key.length - 1 ? null : { agentId: key.slice(0, at), threadId: key.slice(at + 1) };
}
