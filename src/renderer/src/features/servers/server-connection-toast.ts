import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, onCleanup } from "solid-js";

/**
 * A short drop is not an outage. A phone pauses an installed web app each time the user leaves it,
 * and the reconnect after a return takes about 6 seconds. The notice waits this long, counted while
 * the page is visible, so a normal reconnect shows nothing.
 */
const RECONNECT_NOTICE_DELAY_MS = 8_000;

/** A retry changes the same notice. Only a recovered workspace earns a success notice. */
export function createServerConnectionToast(
  read: () => { id: string; name: string; ready: boolean; quiet: boolean } | null,
) {
  let serverId: string | null = null;
  let serverName = "";
  let wasReady = false;
  let outage = false;
  /** The connection dropped and the notice waits for its delay. */
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const id = () => `server-connection:${serverId}`;
  const restoredId = () => `${id()}:restored`;
  const cancelPending = () => {
    pending = false;
    clearTimeout(timer);
    timer = undefined;
  };
  const showOutage = () => {
    cancelPending();
    outage = true;
    const { t } = currentText();
    toast(t("server.connection.reconnecting", { name: serverName }), {
      id: id(),
      description: t("server.connection.cachedHint"),
      duration: Number.POSITIVE_INFINITY,
    });
  };
  /** A hidden page counts no time: the delay starts again when the user comes back. */
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!document.hidden) timer = setTimeout(showOutage, RECONNECT_NOTICE_DELAY_MS);
  };
  const visibility = () => {
    if (pending) schedule();
  };
  document.addEventListener("visibilitychange", visibility);
  createEffect(read, (value) => {
    if (value?.id !== serverId) {
      cancelPending();
      toast.dismiss(id());
      toast.dismiss(restoredId());
      serverId = value?.id ?? null;
      wasReady = false;
      outage = false;
    }
    if (!value) return;
    serverName = value.name;
    if (value.ready) {
      cancelPending();
      toast.dismiss(id());
      if (outage)
        toast.success(currentText().t("server.connection.restored", { name: value.name }), { id: restoredId() });
      wasReady = true;
      outage = false;
    } else if (value.quiet) {
      cancelPending();
      outage = false;
      toast.dismiss(id());
    } else if (wasReady && !outage && !pending) {
      pending = true;
      schedule();
    }
  });
  onCleanup(() => {
    cancelPending();
    document.removeEventListener("visibilitychange", visibility);
    toast.dismiss(id());
    toast.dismiss(restoredId());
  });
}
