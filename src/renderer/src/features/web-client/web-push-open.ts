import { WEB_PUSH_OPEN_PARAMS, type WebPushOpenTarget, webPushOpenTarget } from "@openbot/contracts/web-push";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { onWebNotificationOpen } from "./web-service-worker";

/**
 * The server and agent or channel that a `/app?pushServer=…` link names, as a click on a Web Push
 * notification opens it in a new window. The query is removed after it is read, so a reload does not
 * open it again.
 */
export function takeWebPushOpenLink(): WebPushOpenTarget | null {
  const url = new URL(window.location.href);
  const target = webPushOpenTarget(url.search);
  if (!Object.values(WEB_PUSH_OPEN_PARAMS).some((param) => url.searchParams.has(param))) return target;
  for (const param of Object.values(WEB_PUSH_OPEN_PARAMS)) url.searchParams.delete(param);
  window.history.replaceState(window.history.state, "", url);
  return target;
}

/**
 * Opens the target of a notification click: the link that started this window, once its server is in
 * the host list, and each click while the window is open, which the service worker sends here.
 */
export function watchWebPushOpens(options: {
  startLink: WebPushOpenTarget | null;
  hostListed: (hostId: string) => boolean;
  openAgent: (hostId: string, agentId: string) => void;
  openChannel: (hostId: string, channelId: string) => void;
}): void {
  const [pending, setPending] = createSignal<WebPushOpenTarget | null>(options.startLink);
  const open = (target: WebPushOpenTarget) => {
    if (target.channelId) options.openChannel(target.serverId, target.channelId);
    else if (target.agentId) options.openAgent(target.serverId, target.agentId);
  };
  // The host list loads after the start. A target waits for its server.
  createEffect(
    () => {
      const target = pending();
      return target && options.hostListed(target.serverId) ? target : null;
    },
    (target) => {
      if (!target) return;
      setPending(null);
      open(target);
    },
  );
  onCleanup(
    onWebNotificationOpen((path) => {
      const target = webPushOpenTarget(new URL(path, window.location.origin).search);
      if (target) setPending(target);
    }),
  );
}
