import { MachinesPage } from "@openbot/ui/features/servers/MachinesPage";
import { useOpenMachineAgent } from "./machine-agent-open";
import { createMachinesStore } from "./machines-store";
import { useServerActions } from "./server-actions";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * The Machines page of the desktop window: each server in the order of the server menu, with its
 * agents. An agent on the open server opens at once; an agent on another server opens after the
 * switch to that server.
 */
export function MachinesPanel() {
  const { servers, retryServerConnection } = useServers();
  const { orderedServers } = useServerActions();
  const { openAgent } = useOpenMachineAgent();
  const { openServerSettings } = useServerSettings();
  const store = createMachinesStore({ servers: orderedServers });

  function retry(serverId: string): void {
    const server = servers().find((candidate) => candidate.id === serverId);
    if (server?.kind === "remote" && server.state !== "online") void retryServerConnection(serverId);
    else store.reload(serverId);
  }

  return (
    <div class="machines-panel">
      <MachinesPage
        machines={store.machines()}
        onOpenAgent={(serverId, agentId) => void openAgent(serverId, agentId)}
        onRetry={retry}
        onOpenSettings={(serverId, trigger) => openServerSettings(serverId, trigger)}
      />
    </div>
  );
}
