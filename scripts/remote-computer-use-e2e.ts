// Runs the host and the desktop ends of `remote-computer-use-v1` together: the real loopback MCP
// server of `RemoteComputerHost`, reached with the MCP SDK client that the providers use, and the real
// `RemoteComputerClient`, which runs each call on a stdio MCP driver. The Team API in between is a
// direct link here: an event goes to `handleCall`, and a reply to `RemoteComputerHost.reply` with the
// member and session of the client. The driver is `remote-computer-use-e2e-driver.ts`, a stand-in with
// the driver's tool names, so the test needs no screen grants.
//
// It checks who gets the computer and who is refused: only the agent the entry names, only with its
// own bearer, never a hand-off with no agent, not a reply from another session, not a server whose
// switch is off, and not after Stop.
// `bun scripts/remote-computer-use-e2e.ts`. Writes .openbot-build/remote-computer-use-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig, RemoteComputerServer } from "@openbot/contracts/ipc";
import { REMOTE_COMPUTER_USE_ROUTES } from "@openbot/contracts/team-protocol/remote-computer-use-v1";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { agentMcpServers } from "../src/backend/mcp-provider-shapes";
import { RemoteComputerClient } from "../src/main/remote-computer-client";
import { RemoteComputerHost } from "../src/main/remote-computer-host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-computer-use-e2e");
const MEMBER = "member-1";
const SESSION = "session-1";
const SERVER = "server-1";
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";

const checks: string[] = [];
function pass(name: string): void {
  checks.push(name);
}

const host = new RemoteComputerHost();
let changes = 0;
host.onChanged(() => {
  changes += 1;
});
let enabled = true;
let disabledByStop = false;
const servers = (): RemoteComputerServer[] => [
  { serverId: SERVER, serverName: "Dev host", enabled, supported: true, connected: true },
];
const driver: McpServerConfig = {
  id: "computer-use",
  name: "computer_use",
  transport: "stdio",
  enabled: true,
  command: process.execPath,
  args: [resolve(import.meta.dirname, "remote-computer-use-e2e-driver.ts")],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};
const client = new RemoteComputerClient({
  servers,
  disable: () =>
    Effect.sync(() => {
      enabled = false;
      disabledByStop = true;
    }),
  send: (_serverId, path, body) =>
    Effect.promise(async () => {
      if (path === REMOTE_COMPUTER_USE_ROUTES.state && "available" in body)
        await runCauseEffect(host.setState(MEMBER, SESSION, body));
      else if (path === REMOTE_COMPUTER_USE_ROUTES.reply && "requestId" in body)
        assert.ok(host.reply(MEMBER, SESSION, body), "The host accepts the reply of the session it asked.");
      return {};
    }),
  driver: () => driver,
  computerName: () => "Test Mac",
  toJpeg: () => null,
});
let sent = 0;
host.attach({
  send: (sessionId, event) => {
    if (sessionId !== SESSION) return false;
    sent += 1;
    setImmediate(() => client.handleCall(SERVER, event));
    return true;
  },
  agentsOnlyFor: (memberId) => (memberId === MEMBER ? [AGENT] : []),
});

async function connect(url: string, bearer: string | null): Promise<Client> {
  const mcp = new Client({ name: "provider", version: "1" }, { capabilities: {} });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: bearer ? { headers: { Authorization: bearer } } : {},
    }),
  );
  return mcp;
}

async function refused(url: string, bearer: string | null): Promise<boolean> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: bearer } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  return response.status === 401;
}

const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks };
try {
  // The desktop app says it is available. The host makes one entry, for the one agent.
  client.start();
  await waitFor(() => host.mcpServers().length === 1);
  const [entry] = host.mcpServers();
  assert.ok(entry);
  assert.equal(entry.name, "my_computer");
  assert.equal(changes, 1);
  pass("available computer becomes one my_computer entry for the member's agent");

  assert.equal(agentMcpServers([entry], true, AGENT).length, 1);
  assert.equal(agentMcpServers([entry], true, OTHER_AGENT).length, 0);
  assert.equal(agentMcpServers([entry], true, null).length, 0);
  assert.equal(agentMcpServers([entry], false, AGENT).length, 0);
  pass("only the named agent gets the entry; no agent, another agent, or Computer Use off gets none");

  const bearer = entry.headers.find((pair) => pair.key === "Authorization")?.value ?? null;
  assert.ok(bearer?.startsWith("Bearer "));
  assert.ok(await refused(entry.url, null));
  assert.ok(await refused(entry.url, "Bearer wrong"));
  assert.ok(await refused(entry.url.replace(`/${AGENT}`, `/${OTHER_AGENT}`), bearer));
  pass("no bearer, a wrong bearer, and the bearer on another agent's path get 401");

  const mcp = await connect(entry.url, bearer);
  const tools = (await mcp.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(tools, ["click", "get_desktop_state", "get_screen_size"]);
  pass("tool list comes from the desktop driver, without set_config");

  const screen = await mcp.callTool({ name: "get_desktop_state", arguments: {} });
  const text = JSON.stringify(screen.content);
  assert.match(text, /max_image_dimension\\":1568/u);
  pass("a screenshot without a size is asked at 1568 pixels");

  const blocked = await mcp.callTool({ name: "set_config", arguments: {} });
  assert.equal(blocked.isError, true);
  pass("set_config is refused on the desktop");

  assert.equal(host.reply(MEMBER, "session-2", { requestId: "nope", ok: true, payload: "{}" }), false);
  pass("a reply from another session settles nothing");

  const huge = await mcp.callTool({ name: "click", arguments: { text: "x".repeat(70_000) } });
  assert.equal(huge.isError, true);
  assert.equal((await mcp.callTool({ name: "get_screen_size", arguments: {} })).isError, undefined);
  pass("a request larger than the event allows is refused on the host, and the computer keeps working");

  await runCauseEffect(host.setState("member-2", "session-2", { available: true, computerName: "Other" }));
  assert.equal(host.mcpServers().length, 1);
  assert.equal(changes, 1);
  pass("a member whom no agent may serve does not add a computer or refresh the agents");

  // The switch goes off: the desktop refuses the next call, then tells the host it is gone.
  enabled = false;
  const off = await mcp.callTool({ name: "click", arguments: { x: 1 } });
  assert.equal(off.isError, true);
  pass("a call to a computer whose switch is off is refused");
  client.reconcile();
  await waitFor(() => host.mcpServers().length === 0);
  const gone = await connect(entry.url, bearer);
  assert.deepEqual((await gone.listTools()).tools, []);
  assert.equal((await gone.callTool({ name: "click", arguments: { x: 1 } })).isError, true);
  await gone.close();
  pass("switch off removes the entry; its bearer then gets no tools and a tool error, not a sign-in prompt");

  // On again, then Stop.
  enabled = true;
  client.reconcile();
  await waitFor(() => host.mcpServers().length === 1);
  await runCauseEffect(client.stop(SERVER));
  assert.ok(disabledByStop);
  await waitFor(() => host.mcpServers().length === 0);
  assert.deepEqual(client.sessions(), []);
  pass("Stop turns the switch off, ends the session, and the host drops the computer");
  await mcp.close();
  assert.ok(sent >= 4);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await client.dispose();
  await runCauseEffect(host.stop());
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("A condition did not become true in time.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
