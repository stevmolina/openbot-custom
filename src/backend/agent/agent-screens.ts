// Per-agent screens on a Linux server. The container starts no shared agent display. Each agent
// reserves a display number here, and the hosting script starts that screen on the first use.

import { execFileSync } from "node:child_process";
import { COMPUTER_USE_MCP_SERVER_ID, COMPUTER_USE_MCP_SERVER_NAME, type McpServerConfig } from "@openbot/contracts/ipc";

/** A server whose agents do not share one display. A hosted desktop that sets `OPENBOT_AGENT_DISPLAY` stays shared. */
export function perAgentScreensEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENBOT_SERVER === "1" && !env.OPENBOT_AGENT_DISPLAY && Boolean(env.OPENBOT_AGENT_SCREEN_BIN);
}

function screenBin(env: NodeJS.ProcessEnv): string | null {
  return perAgentScreensEnabled(env) ? (env.OPENBOT_AGENT_SCREEN_BIN ?? null) : null;
}

function runScreen(args: string[], env: NodeJS.ProcessEnv): string | null {
  const bin = screenBin(env);
  if (!bin) return null;
  const output = execFileSync(bin, args, { encoding: "utf8", timeout: 10_000, env }).trim();
  return output.length > 0 ? output : null;
}

/** The display reserved for this agent, or null when agents share one screen. */
export function agentScreenDisplay(agentId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return runScreen(["assign", agentId], env);
}

/** The screen a remote-desktop viewer should open: the one an agent used most recently. */
export function agentScreenViewerDisplay(env: NodeJS.ProcessEnv = process.env): Readonly<Record<string, string>> {
  const display = runScreen(["viewer"], env);
  return display ? { DISPLAY: display } : {};
}

/** The Computer Use entry whose first call starts this agent's screen. */
export function agentScreenMcpServer(agentId: string, env: NodeJS.ProcessEnv = process.env): McpServerConfig | null {
  const command = screenBin(env);
  if (!command) return null;
  return {
    id: COMPUTER_USE_MCP_SERVER_ID,
    name: COMPUTER_USE_MCP_SERVER_NAME,
    transport: "stdio",
    enabled: true,
    command,
    args: ["mcp", agentId],
    env: [],
    envPassthrough: [
      "HOME",
      "PATH",
      "XDG_RUNTIME_DIR",
      "OPENBOT_AGENT_SCREEN_STATE",
      "OPENBOT_AGENT_SCREEN_RUNTIME",
      "OPENBOT_DISPLAY_SIZE",
    ],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

/**
 * The servers this agent is given. In per-agent mode the shared Computer Use entry, which drives
 * one display, is replaced by the entry for this agent. With Computer Use off, nothing is added.
 */
export function withAgentScreen(
  configs: readonly McpServerConfig[],
  agentId: string | null,
  computerUse: boolean,
  env: NodeJS.ProcessEnv = process.env,
): readonly McpServerConfig[] {
  if (!computerUse || !agentId || !perAgentScreensEnabled(env)) return configs;
  const server = agentScreenMcpServer(agentId, env);
  if (!server) return configs;
  return [...configs.filter((config) => config.id !== COMPUTER_USE_MCP_SERVER_ID), server];
}
