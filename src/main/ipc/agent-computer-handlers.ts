// The Agent Computer account of a server: read its status, connect an API key, test it, disconnect,
// and list its machines. Each endpoint goes to this computer's service or to a joined server's
// `agent-computer-v1` routes.

import {
  AGENT_COMPUTER_KEY_INPUT_LIMIT,
  decodeAgentComputerMachineList,
  decodeAgentComputerStatus,
} from "@openbot/contracts/ipc";
import { AGENT_COMPUTER_CAPABILITY, AGENT_COMPUTER_ROUTES } from "@openbot/contracts/team-protocol/agent-computer-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentComputerService } from "../agent-computer-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { stringPayload } from "./validation";

export interface AgentComputerIpcDependencies {
  agentComputer: Pick<AgentComputerService, "status" | "connect" | "test" | "disconnect" | "machines">;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
}

const decodeKey = stringPayload("apiKey", AGENT_COMPUTER_KEY_INPUT_LIMIT);

export function agentComputerIpcHandlers({
  agentComputer,
  remoteServers,
}: AgentComputerIpcDependencies): Pick<IpcGroupHandlers, "agentComputer"> {
  function post<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: Record<string, string> = {}) {
    if (!remoteServers.supportsCapability(serverId, AGENT_COMPUTER_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  return {
    agentComputer: {
      status: scopedQueryHandler({
        local: () => agentComputer.status(),
        remote: (serverId) => post(serverId, AGENT_COMPUTER_ROUTES.status, decodeAgentComputerStatus),
      }),
      connect: scopedHandler(
        (value) => {
          const apiKey = decodeKey(value).trim();
          registerSecretValue(apiKey);
          return apiKey;
        },
        {
          local: (apiKey) => runCauseEffect(agentComputer.connect(apiKey)),
          remote: (apiKey, serverId) =>
            post(serverId, AGENT_COMPUTER_ROUTES.connect, decodeAgentComputerStatus, { apiKey }),
        },
      ),
      test: scopedQueryHandler({
        local: () => runCauseEffect(agentComputer.test()),
        remote: (serverId) => post(serverId, AGENT_COMPUTER_ROUTES.test, decodeAgentComputerStatus),
      }),
      disconnect: scopedQueryHandler({
        local: () => runCauseEffect(agentComputer.disconnect()),
        remote: (serverId) => post(serverId, AGENT_COMPUTER_ROUTES.disconnect, decodeAgentComputerStatus),
      }),
      machines: scopedQueryHandler({
        local: () => runCauseEffect(agentComputer.machines()),
        remote: (serverId) => post(serverId, AGENT_COMPUTER_ROUTES.machines, decodeAgentComputerMachineList),
      }),
    },
  };
}
