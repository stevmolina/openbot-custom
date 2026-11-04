import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { createAgentThreadTabs } from "./agent-thread-tabs";

/** The thread tabs of the active server's agents on this device, and the tabs of all agents. */
const AgentThreads = createSimpleContext({
  name: "AgentThreads",
  init: () => {
    const { activeServerId } = useServers();
    const { activeAgentId } = useAgents();
    // A chat window shows one agent and keeps its tabs, so it does not write the tabs of all agents.
    return createAgentThreadTabs({
      serverId: activeServerId,
      activeAgentId,
      tasks: useAgentTasks(),
      allAgents: !usePlatform().chatWindow,
    });
  },
});

export const AgentThreadsProvider = AgentThreads.provider;
export const useAgentThreads = AgentThreads.use;
