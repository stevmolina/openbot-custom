// The ids of the MCP entries that give one agent Computer Use on a member's own computer, through
// `remote-computer-use-v1`. The host makes one entry for each pair of a computer and an agent that may
// use it, so `agentMcpServers` can keep, for each agent, only the entries made for that agent: an
// entry never reaches an agent that it was not made for, and a hand-off that names no agent gets none.

const PREFIX = "remote-computer:";

export function remoteComputerMcpServerId(computerId: string, agentId: string): string {
  return `${PREFIX}${computerId}:${agentId}`;
}

export function isRemoteComputerMcpServerId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** The agent that a remote computer entry was made for, or null for any other entry. */
export function remoteComputerMcpServerAgentId(id: string): string | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  return separator > 0 && separator < rest.length - 1 ? rest.slice(separator + 1) : null;
}
