import type { AgentComputerStatus } from "@openbot/contracts/ipc";
import type { CloudComputer } from "@openbot/ui/features/servers/CloudComputerList";
import { AgentComputerPanel } from "@openbot/ui/features/settings/AgentComputerPanel";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, untrack } from "solid-js";
import { appPort } from "../../app-port";

/** Where a person makes an Agent Computer API key. */
const AGENT_COMPUTER_KEYS_URL = "https://computer.mcpbox.dev/keys";

/**
 * Server settings > Cloud computers, for this computer or a joined server with `agent-computer-v1`.
 * Every call goes through main, which talks to this server's service or to the host's routes.
 */
export function ServerCloudComputersPanel(props: { serverId: string }) {
  const { t, errorMessage } = useText();
  const api = () => window.openbot.agentComputer;
  const [status, setStatus] = createSignal<AgentComputerStatus | null>(null);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const [machines, setMachines] = createSignal<readonly CloudComputer[] | null>(null);
  const [machinesError, setMachinesError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  /** Bumped for each server, so an answer for an earlier server is dropped. */
  let generation = 0;

  async function loadMachines(serverId: string, current: number): Promise<void> {
    try {
      const list = await api().machines(serverId);
      if (current !== generation) return;
      setMachines(list.machines);
      setMachinesError(null);
    } catch (error) {
      if (current === generation) setMachinesError(errorMessage(error, t("server.cloudComputers.loadFailed")));
    }
  }

  function seen(next: AgentComputerStatus, serverId: string, current: number): void {
    if (current !== generation) return;
    setStatus(next);
    setStatusError(null);
    if (next.connected) void loadMachines(serverId, current);
    else setMachines(null);
  }

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setStatus(null);
      setMachines(null);
      setStatusError(null);
      setMachinesError(null);
      untrack(api)
        .status(serverId)
        .then(
          (next) => seen(next, serverId, current),
          (error: unknown) => {
            if (current === generation) setStatusError(errorMessage(error, t("server.cloudComputers.statusFailed")));
          },
        );
    },
  );

  async function act(key: string, action: (serverId: string) => Promise<AgentComputerStatus>): Promise<void> {
    if (busy()) return;
    const serverId = props.serverId;
    const current = generation;
    setBusy(key);
    try {
      seen(await action(serverId), serverId, current);
    } catch (error) {
      if (current === generation) setStatusError(errorMessage(error, t("server.cloudComputers.statusFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function refresh(): Promise<void> {
    if (busy()) return;
    setBusy("refresh");
    try {
      await loadMachines(props.serverId, generation);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AgentComputerPanel
      status={status()}
      statusError={statusError()}
      machines={machines()}
      machinesError={machinesError()}
      busy={busy()}
      onConnect={(apiKey) => void act("connect", (serverId) => api().connect(apiKey, serverId))}
      onTest={() => void act("test", (serverId) => api().test(serverId))}
      onDisconnect={() => void act("disconnect", (serverId) => api().disconnect(serverId))}
      onRefresh={() => void refresh()}
      onOpenLiveView={(url) => void appPort().openUrl(url)}
      onGetKey={() => void appPort().openUrl(AGENT_COMPUTER_KEYS_URL)}
    />
  );
}
