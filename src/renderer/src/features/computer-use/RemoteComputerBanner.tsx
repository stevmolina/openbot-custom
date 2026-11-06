import type { RemoteComputerSession } from "@openbot/contracts/ipc";
import { Button, MousePointer2 } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { computerUsePort } from "./computer-use-port";

/**
 * Says that an agent on a joined server uses this computer now, with a Stop button. Stop turns off
 * the switch of that server and ends its session, so the next request is refused.
 */
export function RemoteComputerBanner() {
  const { t } = useText();
  const [sessions, setSessions] = createSignal<RemoteComputerSession[]>([]);
  const [stopping, setStopping] = createSignal<string | null>(null);
  let disposed = false;

  const stopListening = computerUsePort().computerUse.onRemoteSessions((next) => {
    if (!disposed) setSessions(next);
  });
  onSettled(() => {
    void computerUsePort()
      .computerUse.getRemoteSessions()
      .then((next) => {
        if (!disposed) setSessions(next);
      })
      .catch(() => undefined);
  });
  onCleanup(() => {
    disposed = true;
    stopListening();
  });

  async function stop(serverId: string): Promise<void> {
    setStopping(serverId);
    try {
      await computerUsePort().computerUse.stopRemoteSession(serverId);
      if (!disposed) setSessions((current) => current.filter((session) => session.serverId !== serverId));
    } finally {
      if (!disposed) setStopping(null);
    }
  }

  return (
    <Show when={sessions().length > 0}>
      <div class="remote-computer-banner-stack" role="status" aria-live="polite">
        <For each={sessions()}>
          {(session) => (
            <div class="remote-computer-banner">
              <MousePointer2 class="remote-computer-banner-icon" aria-hidden="true" />
              <span class="remote-computer-banner-text">
                {t("computerUse.remote.inUse", { server: session.serverName })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                loading={stopping() === session.serverId}
                onClick={() => void stop(session.serverId)}
              >
                {t("computerUse.remote.stop")}
              </Button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
