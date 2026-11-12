import { AGENT_COMPUTER_CAPABILITY } from "@openbot/contracts/team-protocol/agent-computer-v1";
import type { CloudComputer } from "@openbot/ui/features/servers/CloudComputerList";
import { MachinesPage } from "@openbot/ui/features/servers/MachinesPage";
import { createEffect, createSignal } from "solid-js";
import { appPort } from "../../app-port";
import { useOpenMachineAgent } from "./machine-agent-open";
import { createMachinesStore } from "./machines-store";
import { useServerActions } from "./server-actions";
import { serverCanAdminister } from "./server-capabilities";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * The Machines page of the desktop window: each server in the order of the server menu, with its
 * agents. An agent on the open server opens at once; an agent on another server opens after the
 * switch to that server. Each server that this account administers also shows the cloud computers
 * of its Agent Computer account.
 */
export function MachinesPanel() {
  const { servers, retryServerConnection } = useServers();
  const { orderedServers } = useServerActions();
  const { openAgent } = useOpenMachineAgent();
  const { openServerSettings } = useServerSettings();
  const store = createMachinesStore({ servers: orderedServers });
  const [cloudComputers, setCloudComputers] = createSignal<Readonly<Record<string, readonly CloudComputer[]>>>({});

  /** Reads the cloud computers of one online server. A server with no connected account shows none. */
  async function readCloud(serverId: string): Promise<void> {
    const api = window.openbot.agentComputer;
    try {
      const status = await api.status(serverId);
      const machines = status.connected ? (await api.machines(serverId)).machines : [];
      setCloudComputers((current) => ({ ...current, [serverId]: machines }));
    } catch {
      setCloudComputers((current) => ({ ...current, [serverId]: [] }));
    }
  }

  createEffect(
    () =>
      orderedServers()
        .filter((server) => server.state === "online" && serverCanAdminister(server, AGENT_COMPUTER_CAPABILITY))
        .map((server) => server.id)
        .join("\n"),
    (ids) => {
      for (const serverId of ids ? ids.split("\n") : []) void readCloud(serverId);
    },
  );

  function retry(serverId: string): void {
    const server = servers().find((candidate) => candidate.id === serverId);
    if (server?.kind === "remote" && server.state !== "online") void retryServerConnection(serverId);
    else {
      store.reload(serverId);
      void readCloud(serverId);
    }
  }

  return (
    <div class="machines-panel">
      <MachinesPage
        machines={store.machines()}
        onOpenAgent={(serverId, agentId) => void openAgent(serverId, agentId)}
        onRetry={retry}
        onOpenSettings={(serverId, trigger) => openServerSettings(serverId, trigger)}
        cloudComputers={cloudComputers()}
        onOpenLiveView={(url) => void appPort().openUrl(url)}
      />
    </div>
  );
}
