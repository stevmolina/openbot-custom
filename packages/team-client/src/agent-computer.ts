import {
  type AgentComputerMachineList,
  type AgentComputerStatus,
  decodeAgentComputerMachineList,
  decodeAgentComputerStatus,
} from "@openbot/contracts/ipc";
import { AGENT_COMPUTER_ROUTES } from "@openbot/contracts/team-protocol/agent-computer-v1";
import type { TeamApiRequest } from "./team-api-requests";

/** Human-only account controls. The transport supplies authentication and capability checks. */
export interface AgentComputerPort {
  status(serverId: string): Promise<AgentComputerStatus>;
  connect(apiKey: string, serverId: string): Promise<AgentComputerStatus>;
  test(serverId: string): Promise<AgentComputerStatus>;
  disconnect(serverId: string): Promise<AgentComputerStatus>;
  machines(serverId: string): Promise<AgentComputerMachineList>;
}

export function createAgentComputerPort(request: (serverId: string) => TeamApiRequest): AgentComputerPort {
  const status = (serverId: string, path: string, body: { apiKey: string } | Record<string, never> = {}) =>
    request(serverId)("POST", path, decodeAgentComputerStatus, body);
  return {
    status: (id) => status(id, AGENT_COMPUTER_ROUTES.status),
    connect: (apiKey, id) => status(id, AGENT_COMPUTER_ROUTES.connect, { apiKey }),
    test: (id) => status(id, AGENT_COMPUTER_ROUTES.test),
    disconnect: (id) => status(id, AGENT_COMPUTER_ROUTES.disconnect),
    machines: (id) => request(id)("POST", AGENT_COMPUTER_ROUTES.machines, decodeAgentComputerMachineList, {}),
  };
}
