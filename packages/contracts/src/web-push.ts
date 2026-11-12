/**
 * What a host puts into a Web Push notification for the web client (`push-notifications-web-v1`), and
 * the `/app` link that a click on it opens. The host encrypts the payload for the subscription, and the
 * service worker of the web client (`apps/auth-api/service-worker/app-sw.js`) shows it.
 */

/** The decrypted payload, version 1. The service worker shows the app name for anything else. */
export interface WebPushPayload {
  v: 1;
  title: string;
  body: string;
  /** A later notification with the same tag replaces the one on screen. */
  tag?: string;
  /** An `/app` path that opens the agent or the channel on its server. */
  path: string;
}

/** The account service route that gives the VAPID public key of the relay, or `null` without one. */
export const WEB_PUSH_CONFIG_ROUTE = "/v2/web-push/config";

/** The query of an `/app` link that opens a notification's server, and its agent or its channel. */
export const WEB_PUSH_OPEN_PARAMS = {
  server: "pushServer",
  agent: "pushAgent",
  channel: "pushChannel",
} as const;

export interface WebPushOpenTarget {
  serverId: string;
  agentId: string | null;
  channelId: string | null;
}

/** The `/app` path that opens `target`. A channel wins over the agent. */
export function webPushOpenPath(target: WebPushOpenTarget): string {
  const query = new URLSearchParams({ [WEB_PUSH_OPEN_PARAMS.server]: target.serverId });
  if (target.channelId) query.set(WEB_PUSH_OPEN_PARAMS.channel, target.channelId);
  else if (target.agentId) query.set(WEB_PUSH_OPEN_PARAMS.agent, target.agentId);
  return `/app?${query}`;
}

/** The target of an `/app` link, or `null` when it names no server. Ids longer than 128 characters are dropped. */
export function webPushOpenTarget(search: string): WebPushOpenTarget | null {
  const query = new URLSearchParams(search);
  const read = (name: string) => {
    const value = query.get(name);
    return value && value.length <= 128 ? value : null;
  };
  const serverId = read(WEB_PUSH_OPEN_PARAMS.server);
  if (!serverId) return null;
  return { serverId, agentId: read(WEB_PUSH_OPEN_PARAMS.agent), channelId: read(WEB_PUSH_OPEN_PARAMS.channel) };
}
