import type { AgentProfile } from "@openbot/ui/data";
import { threadTabKey } from "@openbot/ui/features/conversation/threads/thread-types";
import type { SidebarThreadLanes } from "@openbot/ui/features/sidebar/sidebar-types";
import { createEffect } from "solid-js";
import { useNavigation } from "../../navigation";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { createThreadActivity } from "../agent-threads/thread-activity";

/**
 * OpenBot Custom: the thread lanes of the sidebar. They live here, so the upstream sidebar host keeps
 * one hook call and one prop.
 */
export function useCustomSidebarThreadLanes(input: {
  agentList: () => readonly AgentProfile[];
  activeServerId: () => string;
  /** The agent whose chat shows now, or undefined while a channel or a person shows. */
  shownAgent: () => AgentProfile | undefined;
}): () => SidebarThreadLanes {
  const { openAgentThread } = useNavigation();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();
  const threadActivity = createThreadActivity();
  /**
   * The lanes list the threads of every agent, so each agent's thread list loads once per server.
   * Events keep a loaded list current.
   */
  const requestedThreadLists = new Set<string>();
  createEffect(
    () =>
      agentTasks.available()
        ? input
            .agentList()
            .map((agent) => `${input.activeServerId()}/${agent.id}`)
            .filter((key) => !requestedThreadLists.has(key))
        : [],
    (keys) => {
      for (const key of keys) {
        requestedThreadLists.add(key);
        const agentId = key.slice(key.indexOf("/") + 1);
        if (!agentTasks.snapshot(agentId)) void agentTasks.loadTasks(agentId);
      }
    },
  );
  return () => {
    const agent = input.shownAgent();
    return {
      threads: threadActivity.entries(),
      activeKey: agent ? threadTabKey(agent.id, agentThreads.activeId(agent.id)) : null,
      unreadAgentIds: threadActivity.unreadAgentIds(),
      onOpenThread: openAgentThread,
    };
  };
}
