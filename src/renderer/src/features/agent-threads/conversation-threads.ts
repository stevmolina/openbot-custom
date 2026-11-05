import type { AgentApproval, AgentContextState, AgentEvent, AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskActive, taskApproval } from "@openbot/team-client/agent-tasks";
import type { AgentProfile } from "@openbot/ui/data";
import {
  activeThreadId,
  type ThreadListsInput,
  threadLists,
} from "@openbot/ui/features/conversation/threads/thread-items";
import {
  DRAFT_THREAD_ID,
  MAIN_THREAD_ID,
  parseThreadTabKey,
  type ThreadHeaderProps,
  type ThreadItem,
  type ThreadStatus,
  threadTabKey,
} from "@openbot/ui/features/conversation/threads/thread-types";
import { sidebarCopyWords } from "@openbot/ui/features/sidebar/sidebar-agent-families";
import type { AgentTasks } from "../agent-tasks/agent-tasks-state";
import type {
  BrowserTakeoverRequest,
  ConversationBranchSource,
  ConversationThreads,
  PromptAnswerOptions,
  SideThread,
} from "../conversation/conversation-types";
import type { AgentThreadTabsState } from "./agent-thread-tabs";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

export interface ConversationThreadsInput {
  agent: { id: string; updatedAt: string };
  tasks: AgentTasks;
  tabs: AgentThreadTabsState;
  /** The approvals that wait on the server. A side thread's turn waits for the one of its own thread. */
  approvals: readonly AgentApproval[];
  /** The questions that wait on the server. A side thread's turn waits for the one of its own thread. */
  prompts: readonly PromptEvent[];
  /** The browser takeovers that wait on the server. A side thread's turn waits for the one of its own thread. */
  takeovers: readonly BrowserTakeoverRequest[];
  newThreadTitle: string;
  onRespondApproval: (
    approval: AgentApproval,
    decision: "accept" | "decline",
    options?: PromptAnswerOptions,
  ) => Promise<boolean>;
  /**
   * The context of each side thread that reported it, by thread id. Only this computer reports it.
   * Read only by `contextState`, so a new runtime snapshot does not build the threads again.
   */
  contextStates?: (() => Readonly<Record<string, AgentContextState>>) | undefined;
  /** Missing when the host cannot compact a side thread. */
  onCompactContext?: ((taskId: string) => Promise<void>) | undefined;
  /**
   * Opens the agent's own chat at a message, as a search result does. Without it, a click on
   * "Branched from" opens the agent's own chat at its latest message.
   */
  onOpenMainMessage?: ((messageId: string) => void) | undefined;
  /**
   * The tabs of all agents. With it, the header shows a tab for each thread of any agent that the user
   * opened, with the agent's face, in the order the user opened them, and the ids of the header are
   * `threadTabKey` values. Without it, as in the browser client, the header shows this agent's tabs.
   */
  allTabs?: AllAgentTabsInput | undefined;
}

interface AllAgentTabsInput {
  agents: readonly AgentProfile[];
  /** The state of a thread of any agent, as its tab shows it. */
  status: (agentId: string, threadId: string) => ThreadStatus;
  /** Shows another agent's chat with one of its threads open. */
  open: (agentId: string, threadId: string) => void;
}

/** The threads of one agent, for the conversation. Read it in a memo: it reads the thread state. */
export function conversationThreads(input: ConversationThreadsInput): ConversationThreads {
  const { agent, tasks, tabs, approvals, prompts, takeovers, onCompactContext, allTabs } = input;
  const agentId = agent.id;
  const snapshot = tasks.snapshot(agentId);
  const list = snapshot?.tasks ?? [];
  const listInput: Omit<ThreadListsInput, "open" | "draft"> = {
    mainUpdatedAt: agent.updatedAt,
    tasks: list,
    draftTitle: input.newThreadTitle,
    hidden: tabs.hidden(),
    waitsFor: (task) =>
      taskApproval(task, approvals) !== undefined
        ? "approval"
        : ofTaskThread(task, prompts) !== undefined
          ? "question"
          : ofTaskThread(task, takeovers) !== undefined
            ? "takeover"
            : undefined,
    unread: (task) => tasks.unreadCount(task),
  };
  const lists = threadLists({ ...listInput, open: tabs.openIds(agentId), draft: tabs.hasDraft(agentId) });
  const activeId = activeThreadId(lists.tabs, tabs.activeId(agentId));
  const open =
    activeId === MAIN_THREAD_ID
      ? undefined
      : activeId === DRAFT_THREAD_ID
        ? null
        : list.find((task) => task.id === activeId);
  const approval = open ? taskApproval(open, approvals) : undefined;
  const editable = tasks.editable();
  /** A thread in the side panel, with the actions of its own message box. */
  const sideThread = (id: string): SideThread | undefined => {
    const task = list.find((entry) => entry.id === id);
    if (!task) return undefined;
    const sideApproval = taskApproval(task, approvals);
    return {
      task,
      conversation: tasks.conversation(task.id),
      approval: sideApproval,
      onSend: (text, attachmentDraftIds, replyToMessageId) =>
        tabs.send(agentId, task.id, text, attachmentDraftIds, replyToMessageId),
      onStop: () => tasks.stopTask(agentId, task.id),
      onRead: (messageId) => tasks.markTaskRead(agentId, task.id, messageId),
      onRespondApproval: (decision, options) =>
        sideApproval ? input.onRespondApproval(sideApproval, decision, options) : Promise.resolve(false),
      get contextState() {
        return input.contextStates?.()[task.threadId];
      },
      onCompactContext: onCompactContext ? () => onCompactContext(task.id) : undefined,
    };
  };
  /**
   * The source of a branch. The list has the current title of a listed source. The list can leave out an
   * archived source, so the link's title is the fallback; a link with no title is a deleted source.
   */
  const branchSource = (task: AgentTask): ConversationBranchSource | undefined => {
    const branch = task.branch;
    if (!branch) return undefined;
    const { sourceTaskId, sourceMessageId, throughMessageId } = branch;
    if (sourceTaskId === null)
      return {
        throughMessageId,
        title: null,
        deleted: false,
        onOpen: () => {
          tabs.open(agentId, MAIN_THREAD_ID);
          input.onOpenMainMessage?.(sourceMessageId);
        },
      };
    const title = list.find((entry) => entry.id === sourceTaskId)?.title ?? branch.sourceTitle;
    return {
      throughMessageId,
      title,
      deleted: title === null,
      onOpen: () => void tabs.openAt(agentId, sourceTaskId, sourceMessageId),
    };
  };
  /** The tabs of this agent: its side threads and its new thread. */
  const agentHeader = (): ThreadHeaderProps => ({
    ...lists,
    activeId,
    canStartNew: true,
    onOpen: (id) => tabs.open(agentId, id),
    onNew: () => tabs.startNew(agentId),
    onClose: (id) => tabs.close(agentId, id),
    onCloseOthers: (id) => tabs.closeOthers(agentId, id),
    onCloseToTheRight: (id) => tabs.closeToTheRight(agentId, id),
    onMove: (id, index) => tabs.move(agentId, id, index),
    onArchive: (id) => void tabs.archive(agentId, id),
    onRestore: (id) => void tabs.restore(agentId, id),
    onRename: editable ? (id, title) => void tabs.rename(agentId, id, title) : undefined,
    onDelete: editable ? (id) => void tabs.remove(agentId, id) : undefined,
  });
  const focus = tabs.messageFocus();
  return {
    background: list.filter((task) => task.state === "running" || task.state === "queued"),
    header: input.allTabs ? allAgentHeader(input, input.allTabs, lists, activeId) : agentHeader(),
    side: {
      tabs: threadLists({ ...listInput, open: tabs.sideIds(agentId), draft: false }).tabs,
      thread: sideThread,
      onToSide: (id) => tabs.toSide(agentId, id),
      onToChat: (id) => tabs.toChat(agentId, id),
      onClose: (id) => tabs.closeSide(agentId, id),
      onMove: (id, index) => tabs.moveSide(agentId, id, index),
    },
    open,
    tasks: list,
    limit: snapshot?.limit ?? 1,
    running: list.filter(isAgentTaskActive).length,
    conversation: open ? tasks.conversation(open.id) : undefined,
    approval,
    acceptsFiles: tasks.filesAccepted(),
    acceptsReplies: tasks.repliable(),
    onSend: (text, attachmentDraftIds, replyToMessageId) =>
      open
        ? tabs.send(agentId, open.id, text, attachmentDraftIds, replyToMessageId)
        : tabs.sendDraft(agentId, text, attachmentDraftIds),
    onStop: () => {
      if (open) tasks.stopTask(agentId, open.id);
    },
    onRead: (messageId) => {
      if (open) tasks.markTaskRead(agentId, open.id, messageId);
    },
    onRespondApproval: (decision, options) =>
      approval ? input.onRespondApproval(approval, decision, options) : Promise.resolve(false),
    get contextState() {
      return open ? input.contextStates?.()[open.threadId] : undefined;
    },
    onCompactContext: open && onCompactContext ? () => onCompactContext(open.id) : undefined,
    // Custom: the new thread moves to another agent. The draft of this agent closes, and the other agent's opens.
    onChangeDraftAgent: allTabs && open === null ? (target) => changeDraftAgent(input, allTabs, target) : undefined,
    // Only this computer moves a queued message to a new thread.
    onRunQueuedMessage: tasks.local() ? (deliveryId) => void tabs.runQueuedMessage(agentId, deliveryId) : undefined,
    queueActions: tasks.queueActions()
      ? {
          cancel: (deliveryId) => tasks.cancelQueuedMessage(agentId, deliveryId),
          steer: (task, deliveryId) => {
            if (task.activeTurnId) tasks.steerQueuedMessage(agentId, task.id, deliveryId, task.activeTurnId);
          },
          reorder: (taskId, deliveryIds) => tasks.reorderQueue(agentId, taskId, deliveryIds),
        }
      : undefined,
    onBranch: tasks.canBranch()
      ? (sourceTaskId, messageId) => tabs.branch(agentId, sourceTaskId, messageId)
      : undefined,
    onDeleteMessage: tasks.canDeleteMessage()
      ? (taskId, messageId) => tasks.deleteTaskMessage(agentId, taskId, messageId)
      : undefined,
    branchSource,
    routineThread: (routineId) => {
      const task = routineTask(list, routineId);
      return task ? () => tabs.open(agentId, task.id) : undefined;
    },
    onOpenRoutineThread: async (routineId) => {
      const listed = () => routineTask(tasks.snapshot(agentId)?.tasks ?? [], routineId);
      if (!listed()) await tasks.loadTasks(agentId);
      const task = listed();
      if (task) tabs.open(agentId, task.id);
      return task !== undefined;
    },
    focusMessage: focus && list.some((task) => task.id === focus.taskId) ? focus : null,
  };
}

/** Custom: starts the new thread with another agent, and closes the new thread of this one. */
function changeDraftAgent(input: ConversationThreadsInput, all: AllAgentTabsInput, target: string): void {
  const { agent, tabs } = input;
  if (target === agent.id || !all.agents.some((profile) => profile.id === target)) return;
  tabs.startNew(target);
  tabs.close(agent.id, DRAFT_THREAD_ID);
  all.open(target, DRAFT_THREAD_ID);
}

/** The open side thread where the routine runs. */
function routineTask(list: readonly AgentTask[], routineId: string): AgentTask | undefined {
  return list.find((task) => task.routineId === routineId && task.state !== "closed");
}

type TaskThread = { agentId: string; threadId: string };

/** The question or takeover that the turn of this task waits for: the one of the task's own thread. */
function ofTaskThread<Request extends TaskThread>(task: TaskThread, requests: readonly Request[]): Request | undefined {
  return requests.find((request) => request.agentId === task.agentId && request.threadId === task.threadId);
}

/**
 * The header of the tabs of all agents. Each id is a `threadTabKey`. An id without an agent, such as a
 * task id that a message link opens, names a thread of the agent on screen.
 */
function allAgentHeader(
  input: ConversationThreadsInput,
  all: AllAgentTabsInput,
  lists: { threads: ThreadItem[]; archived: ThreadItem[] },
  activeThread: string,
): ThreadHeaderProps {
  const { agent, tasks, tabs } = input;
  const agentId = agent.id;
  const agentById = new Map(all.agents.map((profile) => [profile.id, profile]));
  const copyWords = sidebarCopyWords(all.agents);
  const hidden = tabs.hidden();
  const items: ThreadItem[] = tabs.openTabs().flatMap((tab): ThreadItem[] => {
    const profile = agentById.get(tab.agentId);
    if (!profile) return [];
    const base = {
      id: threadTabKey(tab.agentId, tab.threadId),
      agent: { profile, copy: copyWords.get(profile.id) ?? null, onScreen: profile.id === agentId },
    };
    const updatedAt = profile.updatedAt ?? profile.time;
    if (tab.threadId === MAIN_THREAD_ID)
      return [
        // The tab of the agent's own chat has the agent's name, so the header still names each agent.
        { ...base, kind: "main", title: profile.name, updatedAt, status: all.status(tab.agentId, tab.threadId) },
      ];
    if (tab.threadId === DRAFT_THREAD_ID)
      return tabs.hasDraft(tab.agentId)
        ? [{ ...base, kind: "draft", title: input.newThreadTitle, updatedAt, status: { kind: "idle" } }]
        : [];
    const task = tasks.snapshot(tab.agentId)?.tasks.find((entry) => entry.id === tab.threadId);
    if (!task || task.state === "closed" || hidden.has(task.id)) return [];
    return [
      {
        ...base,
        kind: "side",
        title: task.title,
        updatedAt: task.updatedAt,
        status: all.status(tab.agentId, tab.threadId),
        unread: tasks.unreadCount(task),
      },
    ];
  });
  const keys = items.map((item) => item.id);
  const activeKey = threadTabKey(agentId, activeThread);
  const resolve = (id: string) => parseThreadTabKey(id) ?? { agentId, threadId: id };
  const open = (id: string) => {
    const target = resolve(id);
    if (target.agentId === agentId) tabs.open(agentId, target.threadId);
    else all.open(target.agentId, target.threadId);
  };
  const keyed = (item: ThreadItem): ThreadItem => ({ ...item, id: threadTabKey(agentId, item.id) });
  const editable = tasks.editable();
  return {
    threads: lists.threads.map(keyed),
    archived: lists.archived.map(keyed),
    tabs: items,
    activeId: activeKey,
    allAgents: true,
    canStartNew: true,
    onOpen: open,
    onNew: () => tabs.startNew(agentId),
    // The tab to the left opens in place of a closed open tab, else the tab to the right.
    onClose: (id) => {
      const key = threadTabKey(resolve(id).agentId, resolve(id).threadId);
      const index = keys.indexOf(key);
      // The last tab stays: the chat on screen always has its tab.
      if (keys.length <= 1 && key === activeKey) return;
      const next = keys[index - 1] ?? keys[index + 1];
      const target = resolve(key);
      tabs.closeOpenTab(target.agentId, target.threadId);
      if (key === activeKey && next) open(next);
    },
    onCloseOthers: (id) => {
      const target = resolve(id);
      const key = threadTabKey(target.agentId, target.threadId);
      tabs.retainOpenTabs(new Set([key]));
      if (key !== activeKey) open(key);
    },
    onCloseToTheRight: (id) => {
      const target = resolve(id);
      const kept = keys.slice(0, keys.indexOf(threadTabKey(target.agentId, target.threadId)) + 1);
      tabs.retainOpenTabs(new Set(kept));
      if (!kept.includes(activeKey) && kept.length > 0) open(kept[kept.length - 1] ?? activeKey);
    },
    onMove: (id, index) => {
      const target = resolve(id);
      tabs.moveOpenTab(keys, threadTabKey(target.agentId, target.threadId), index);
    },
    onArchive: (id) => {
      const target = resolve(id);
      void tabs.archive(target.agentId, target.threadId);
    },
    onRestore: (id) => {
      const target = resolve(id);
      if (target.agentId === agentId) void tabs.restore(agentId, target.threadId);
    },
    onRename: editable
      ? (id, title) => {
          const target = resolve(id);
          void tabs.rename(target.agentId, target.threadId, title);
        }
      : undefined,
    onDelete: editable
      ? (id) => {
          const target = resolve(id);
          void tabs.remove(target.agentId, target.threadId);
        }
      : undefined,
  };
}
