import type { RemoteComputerServer } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Switch,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { computerUsePort } from "./computer-use-port";

/**
 * The switch that lets the agents of one joined server use Computer Use on this computer. It is a
 * setting of this computer, it starts off, and only the agents that only this user can use on that
 * server get the computer.
 */
export function RemoteComputerSettings() {
  const { t, errorMessage } = useText();
  const [servers, setServers] = createSignal<RemoteComputerServer[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let disposed = false;

  const stop = computerUsePort().computerUse.onRemoteServers((next) => {
    if (!disposed) setServers(next);
  });
  onSettled(() => {
    void computerUsePort()
      .computerUse.listRemoteServers()
      .then((next) => {
        if (!disposed) setServers(next);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(errorMessage(cause, t("computerUse.remote.error")));
      });
  });
  onCleanup(() => {
    disposed = true;
    stop();
  });

  async function setEnabled(server: RemoteComputerServer, enabled: boolean): Promise<void> {
    if (busy()) return;
    setBusy(server.serverId);
    setError(null);
    try {
      const next = await computerUsePort().computerUse.setRemoteServer({ serverId: server.serverId, enabled });
      if (!disposed) setServers(next);
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause, t("computerUse.remote.error")));
    } finally {
      if (!disposed) setBusy(null);
    }
  }

  const state = (server: RemoteComputerServer) => {
    if (!server.supported && server.connected) return t("computerUse.remote.unsupported");
    if (!server.connected) return t("computerUse.remote.offline");
    return server.enabled ? t("computerUse.remote.on") : t("computerUse.remote.off");
  };

  return (
    <Show when={servers().length > 0}>
      <SettingsSection
        data-settings-row="computerUse.remote.title"
        title={t("computerUse.remote.title")}
        description={t("computerUse.remote.description")}
      >
        <ItemGroup class="settings-modal-card computer-use-card">
          <For each={servers()}>
            {(server) => (
              <Item class="settings-modal-row computer-use-row">
                <ItemContent>
                  <ItemTitle>{server.serverName}</ItemTitle>
                  <ItemDescription>{state(server)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={t("computerUse.remote.switchLabel", { server: server.serverName })}
                    checked={server.enabled}
                    disabled={busy() !== null || (!server.enabled && !server.supported)}
                    onChange={(enabled: boolean) => void setEnabled(server, enabled)}
                  />
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
        <Show when={error()}>
          {(message) => (
            <Alert tone="danger" class="computer-use-alert" role="alert">
              <AlertContent>
                <AlertDescription>{message()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>
      </SettingsSection>
    </Show>
  );
}
