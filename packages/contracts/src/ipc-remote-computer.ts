import { isDynamicRecord, isString } from "./runtime-values";

// Computer Use on this computer for the agents of a joined server (`remote-computer-use-v1`). The
// switch is a setting of this computer, not of the server, and it starts off.

/** One joined server, and whether its agents may use this computer. */
export interface RemoteComputerServer {
  serverId: string;
  serverName: string;
  /** The user let the agents of this server use this computer. */
  enabled: boolean;
  /** The host can give this computer to its agents. False for an older host. */
  supported: boolean;
  /** The server is connected now. */
  connected: boolean;
}

/** An agent on a joined server is using this computer now. */
export interface RemoteComputerSession {
  serverId: string;
  serverName: string;
  /** When the first request of this session came, in milliseconds since the epoch. */
  startedAt: number;
}

export interface SetRemoteComputerServerInput {
  serverId: string;
  enabled: boolean;
}

function decodeServer(value: unknown): RemoteComputerServer {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !isString(value.serverName) ||
    typeof value.enabled !== "boolean" ||
    typeof value.supported !== "boolean" ||
    typeof value.connected !== "boolean"
  )
    throw new Error("Invalid remote computer server.");
  return {
    serverId: value.serverId,
    serverName: value.serverName,
    enabled: value.enabled,
    supported: value.supported,
    connected: value.connected,
  };
}

export function decodeRemoteComputerServers(value: unknown): RemoteComputerServer[] {
  if (!Array.isArray(value)) throw new Error("Invalid remote computer servers.");
  return value.map(decodeServer);
}

export function decodeRemoteComputerSessions(value: unknown): RemoteComputerSession[] {
  if (!Array.isArray(value)) throw new Error("Invalid remote computer sessions.");
  return value.map((session) => {
    if (
      !isDynamicRecord(session) ||
      !isString(session.serverId) ||
      !isString(session.serverName) ||
      typeof session.startedAt !== "number" ||
      !Number.isFinite(session.startedAt)
    )
      throw new Error("Invalid remote computer session.");
    return { serverId: session.serverId, serverName: session.serverName, startedAt: session.startedAt };
  });
}

export function parseSetRemoteComputerServerInput(value: unknown): SetRemoteComputerServerInput {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !value.serverId.length ||
    value.serverId.length > 256 ||
    typeof value.enabled !== "boolean"
  )
    throw new Error("Invalid remote computer setting.");
  return { serverId: value.serverId, enabled: value.enabled };
}

export function parseRemoteComputerServerId(value: unknown): string {
  if (!isString(value) || !value.length || value.length > 256) throw new Error("Invalid server.");
  return value;
}
