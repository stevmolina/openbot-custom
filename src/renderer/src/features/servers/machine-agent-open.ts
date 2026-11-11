import { classifyFailure } from "@openbot/telemetry";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { useNavigation } from "../../navigation";
import { useServerSelection } from "./server-selection";
import { useServerSwitch } from "./server-switch";
import { useServers } from "./servers-context";

/**
 * Opens an agent on its own server, from the Machines page or the "All machines" view. An agent on
 * the open server opens at once; an agent on another server opens after the switch to that server.
 * The switch rebuilds the server scope, so the selection goes through the context above it.
 */
export function useOpenMachineAgent() {
  const { t, errorMessage } = useText();
  const { activeServerId } = useServers();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const { selectAgent } = useNavigation();

  /** Switches to a server. False when the switch did not happen; a failure shows a toast. */
  async function switchTo(serverId: string): Promise<boolean> {
    try {
      return await selectServer(serverId);
    } catch (error) {
      actionToast.error(t("server.select.failedTitle"), {
        description: errorMessage(error, t("server.select.failedDescription")),
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
      return false;
    }
  }

  async function openAgent(serverId: string, agentId: string): Promise<void> {
    if (activeServerId() === serverId) {
      selectAgent(agentId);
      return;
    }
    if (await switchTo(serverId)) setPendingAgentSelection(agentId);
  }

  return { openAgent, switchTo };
}
