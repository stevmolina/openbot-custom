import type { AgentTask } from "@openbot/contracts/ipc";
import { MAIN_THREAD_ID, type ThreadStatus } from "@openbot/ui/features/conversation/threads/thread-types";
import {
  computeSidebarAgentStates,
  isAgentWorking,
  sidebarThreadWait,
} from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { SidebarThreadEntry } from "@openbot/ui/features/sidebar/sidebar-types";
import { createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { attentionKey } from "../agents/agent-runtime-snapshot";
import { agentThreadAttention } from "../agents/agent-thread-attention";
import { useAgents } from "../agents/agents-context";
import { useConversation } from "../conversation/conversation-context";
import { useAgentThreads } from "./agent-threads-context";

/** What a thread needs now: the user, or nothing while it works. Null for a thread at rest. */
export type ThreadActivityState = SidebarThreadEntry["state"];

/**
 * What each thread of each agent does now: the agent's own chat and each open side thread. The
 * sidebar lanes and the tabs of all agents read it. A side thread shows only when its agent's
 * thread list loaded; `agent-tasks-changed` events keep each loaded list current.
 */
export function createThreadActivity() {
  const { agentList } = useAgents();
  const turns = useTurns();
  const { unreadReplies, agentUnreadReplies, recentReplies } = useConversation();
  const tasks = useAgentTasks();
  const tabs = useAgentThreads();

  /** The badge of each agent's own chat. A turn of a side thread is not in it. */
  const mainStates = createMemo(() =>
    computeSidebarAgentStates({
      agentIds: agentList().map((agent) => agent.id),
      activeTurns: turns.activeTurns(),
      queues: turns.queues(),
      unreadReplies: unreadReplies(),
      recentReplies: recentReplies(),
      ...agentThreadAttention({
        agents: agentList(),
        pendingPrompts: turns.pendingPrompts(),
        approvals: turns.approvals(),
      }),
      failedTurns: turns.failedTurns(),
      usageLimits: turns.usageLimits(),
    }),
  );

  /** The agent's own chat: a wait for the user first, then a running turn. */
  function mainState(agentId: string): ThreadActivityState | null {
    const state = mainStates()[agentId];
    if (state?.kind === "waiting") return state;
    // A background subagent that runs on after its turn keeps the agent's own chat at work.
    if (turns.subagentTurns()[agentId]) return { kind: "working" };
    return isAgentWorking(agentId, turns.activeTurns(), turns.queues()) ? { kind: "working" } : null;
  }

  /** A side thread: a running turn that waits for the user, or works. */
  function sideState(task: AgentTask): ThreadActivityState | null {
    if (task.state !== "running") return null;
    const prompt = turns.pendingPrompts()[attentionKey(task.agentId, task.threadId)];
    const approval = turns
      .approvals()
      .find((entry) => entry.agentId === task.agentId && entry.threadId === task.threadId);
    return sidebarThreadWait(prompt, approval) ?? { kind: "working" };
  }

  /** The state of a thread as a tab shows it. A thread at rest has no badge. */
  function threadStatus(agentId: string, threadId: string): ThreadStatus {
    const task =
      threadId === MAIN_THREAD_ID ? undefined : tasks.snapshot(agentId)?.tasks.find((entry) => entry.id === threadId);
    const state = threadId === MAIN_THREAD_ID ? mainState(agentId) : task ? sideState(task) : null;
    if (state?.kind === "waiting") return { kind: "waiting", reason: state.reason };
    if (state?.kind === "working") return { kind: "working" };
    if (task?.state === "queued") return { kind: "queued" };
    if (task?.outcome === "failed") return { kind: "failed" };
    return { kind: "idle" };
  }

  /** Each thread that needs the user or works, of every agent. */
  const entries = createMemo((): SidebarThreadEntry[] => {
    const hidden = tabs.hidden();
    const result: SidebarThreadEntry[] = [];
    for (const agent of agentList()) {
      const main = mainState(agent.id);
      if (main)
        result.push({
          agentId: agent.id,
          threadId: MAIN_THREAD_ID,
          title: null,
          state: main,
          updatedAt: agent.updatedAt ?? null,
        });
      for (const task of tasks.snapshot(agent.id)?.tasks ?? []) {
        if (task.state === "closed" || hidden.has(task.id)) continue;
        const state = sideState(task);
        if (state)
          result.push({ agentId: agent.id, threadId: task.id, title: task.title, state, updatedAt: task.updatedAt });
      }
    }
    // The thread that changed last comes first.
    return result.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  });

  /** The agents with a reply that the user did not read, in their own chat or a side thread. */
  const unreadAgentIds = createMemo(() => {
    const unread = agentUnreadReplies();
    return new Set(Object.keys(unread).filter((agentId) => (unread[agentId] ?? 0) > 0));
  });

  return { entries, threadStatus, unreadAgentIds };
}
