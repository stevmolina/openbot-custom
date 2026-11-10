import { classifyFailure } from "@openbot/telemetry";
import { MachinesPage } from "@openbot/ui/features/servers/MachinesPage";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { useNavigation } from "../../navigation";
import { createMachinesStore } from "./machines-store";
import { useServerActions } from "./server-actions";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";

/**
 * The Machines page of the desktop window: each server in the order of the server menu, with its
 * agents. An agent on the open server opens at once; an agent on another server opens after the
 * switch to that server.
 */
export function MachinesPanel() {
  const { t, errorMessage } = useText();
  const { servers, retryServerConnection } = useServers();
  const { orderedServers } = useServerActions();
  const { selectServer } = useServerSelection();
  // The switch rebuilds this scope, so the selection goes through the context above it.
  const { setPendingAgentSelection } = useServerSwitch();
  const { selectAgent } = useNavigation();
  const { openServerSettings } = useServerSettings();
  const store = createMachinesStore({ servers: orderedServers });

  async function openAgent(serverId: string, agentId: string): Promise<void> {
    if (servers().find((server) => server.active)?.id === serverId) {
      selectAgent(agentId);
      return;
    }
    try {
      if (!(await selectServer(serverId))) return;
    } catch (error) {
      actionToast.error(t("server.select.failedTitle"), {
        description: errorMessage(error, t("server.select.failedDescription")),
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
      return;
    }
    setPendingAgentSelection(agentId);
  }

  function retry(serverId: string): void {
    const server = servers().find((candidate) => candidate.id === serverId);
    if (server?.kind === "remote" && server.state !== "online") void retryServerConnection(serverId);
    else store.reload(serverId);
  }

  return (
    <MachinesPage
      machines={store.machines()}
      onOpenAgent={(serverId, agentId) => void openAgent(serverId, agentId)}
      onRetry={retry}
      onOpenSettings={(serverId, trigger) => openServerSettings(serverId, trigger)}
    />
  );
}
