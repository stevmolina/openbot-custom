import {
  type AgentComputerMachine,
  type AgentComputerStatus,
  DISCONNECTED_AGENT_COMPUTER,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";

/** The Agent Computer account of each server. Any key connects; the list has one running and one paused computer. */
export function createMockAgentComputer(): OpenBotDesktopApi["agentComputer"] {
  const statuses = new Map<string, AgentComputerStatus>();
  const status = (serverId: string) => statuses.get(serverId) ?? DISCONNECTED_AGENT_COMPUTER;
  const machines = (): AgentComputerMachine[] => [
    {
      id: "sbx_preview_work",
      context: "work",
      status: "running",
      deadlineAt: new Date(Date.now() + 40 * 60_000).toISOString(),
      liveViewUrl: "https://computer.mcpbox.dev/live/preview",
      updatedAt: new Date().toISOString(),
    },
    {
      id: "sbx_preview_video",
      context: "video",
      status: "paused",
      deadlineAt: null,
      liveViewUrl: "https://computer.mcpbox.dev/live/preview-video",
      updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    },
  ];
  return {
    status: async (serverId) => status(serverId),
    connect: async (apiKey, serverId) => {
      const next = { connected: true, keyHint: apiKey.slice(0, 12), error: null };
      statuses.set(serverId, next);
      return next;
    },
    test: async (serverId) => status(serverId),
    disconnect: async (serverId) => {
      statuses.delete(serverId);
      return DISCONNECTED_AGENT_COMPUTER;
    },
    machines: async (serverId) => ({ machines: status(serverId).connected ? machines() : [] }),
  };
}
