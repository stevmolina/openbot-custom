import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentScreenDisplay, agentScreenMcpServer, perAgentScreensEnabled, withAgentScreen } from "./agent-screens";

const script = join(import.meta.dirname, "../../../scripts/hosting/openbot-agent-screen");

function screenEnv(root: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENBOT_AGENT_DISPLAY;
  env.OPENBOT_SERVER = "1";
  env.OPENBOT_AGENT_SCREEN_BIN = script;
  env.OPENBOT_AGENT_SCREEN_STATE = join(root, "state");
  env.OPENBOT_AGENT_SCREEN_RUNTIME = join(root, "runtime");
  return env;
}

describe("per-agent screens", () => {
  it("stays off unless the server has no shared display", () => {
    expect(
      perAgentScreensEnabled({ OPENBOT_SERVER: "1", OPENBOT_AGENT_DISPLAY: ":1", OPENBOT_AGENT_SCREEN_BIN: script }),
    ).toBe(false);
    expect(perAgentScreensEnabled({ OPENBOT_SERVER: "1", OPENBOT_AGENT_SCREEN_BIN: script })).toBe(true);
  });

  it("reserves a different display for each agent and keeps it", () => {
    const env = screenEnv(mkdtempSync(join(tmpdir(), "openbot-screens-")));
    expect(agentScreenDisplay("agent-a", env)).toBe(":2");
    expect(agentScreenDisplay("agent-b", env)).toBe(":3");
    expect(agentScreenDisplay("agent-a", env)).toBe(":2");
  });

  it("points Computer Use at that agent's screen command", () => {
    const env = screenEnv(mkdtempSync(join(tmpdir(), "openbot-screens-")));
    const server = agentScreenMcpServer("agent-a", env);
    expect(server?.args).toEqual(["mcp", "agent-a"]);
    const given = withAgentScreen(
      [
        {
          id: "openbot-computer-use",
          name: "computer_use",
          transport: "stdio",
          enabled: true,
          command: "shared-driver",
          args: ["mcp"],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: "",
          headers: [],
        },
      ],
      "agent-a",
      true,
      env,
    );
    expect(given.map((config) => config.command)).toEqual([script]);
  });

  it("stops an idle screen and keeps its display number", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-screens-"));
    const env = screenEnv(root);
    expect(agentScreenDisplay("agent-a", env)).toBe(":2");
    const dir = join(root, "state", "agent-a");
    writeFileSync(join(dir, "last-used"), "1");
    writeFileSync(join(dir, "xvfb.pid"), "99999999");
    execFileSync(script, ["reap"], { env, encoding: "utf8" });
    expect(agentScreenDisplay("agent-a", env)).toBe(":2");
  });
});
