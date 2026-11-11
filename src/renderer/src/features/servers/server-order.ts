import type { ServerSummary } from "@openbot/contracts/ipc";

/**
 * The server on this computer while the user hides it. An open server always shows, and without
 * another server it is the only one.
 */
export function hiddenLocalServerOf(
  servers: readonly ServerSummary[],
  localHidden: boolean,
): ServerSummary | undefined {
  if (!localHidden || !servers.some((server) => server.kind === "remote")) return undefined;
  return servers.find((server) => server.kind === "local" && !server.active);
}

/**
 * Local servers above the saved remote-server order, as the rail draws them. A hidden server is left
 * out. The server menu, the rail, the Machines page and the "All machines" view share this order.
 */
export function orderServers(servers: readonly ServerSummary[], localHidden: boolean): ServerSummary[] {
  const hidden = hiddenLocalServerOf(servers, localHidden);
  return [
    ...servers.filter((server) => server.kind === "local" && server !== hidden),
    ...servers.filter((server) => server.kind === "remote"),
  ];
}
