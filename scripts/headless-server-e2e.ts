// Starts this worktree's dev stack as a server, with `OPENBOT_DEV_HEADLESS_SERVER=1`: the host takes the
// start of a self-hosted or hosted server, whose main window loads no app page. The test client of the
// stack joins the host over the Team API, as a desktop app joins a VPS: over WebRTC as the host's owner
// by default, or over HTTP as a member with `--transport=http`. The script checks that
// the host has no app page and no Dynamic Island page, records the memory of each host process while it
// is idle, and checks from the client that the host is online and lists its agents.
//
// With `--allow-mutations`, the client also makes one agent on the host whose first message asks it
// to open a page in its browser. The script waits for the reply, checks that the host's agent browser
// loaded the page, and deletes the agent. The turn runs on a provider of this computer: the host picks
// its default unless `--provider=<id>` names one.
//
// `--baseline` starts the stack without the flag, as every server started before this change, and
// records the same memory for a comparison. `--idle-minutes=<n>` waits that long before the samples. `--keep` leaves the stack running; stop it with
// `bun run dev:stop`. Run: `bun scripts/headless-server-e2e.ts --allow-mutations`.
// Writes .openbot-build/headless-server-e2e/<report|baseline>.json and a screenshot of the client.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import { canAdministerServer, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/headless-server-e2e");
const baseline = process.argv.includes("--baseline");
const allowMutations = process.argv.includes("--allow-mutations");
const keep = process.argv.includes("--keep");
const providerArgument = process.argv
  .find((argument) => argument.startsWith("--provider="))
  ?.slice("--provider=".length);
const provider = providerArgument === undefined ? null : providerArgument;
if (provider !== null && !isAgentProvider(provider)) throw new Error(`Unknown provider: ${provider}.`);
// A checked value for the page function, which cannot call the imported guard.
const chosenProvider = provider !== null && isAgentProvider(provider) ? provider : null;
// WebRTC by default: the client then joins as the host's owner, as the web app and phones do, through the
// host's WebRTC bridge window. Only an owner or an admin can delete the agent that the check makes.
const transport = process.argv.includes("--transport=http") ? "http" : "webrtc";
const label = baseline ? "baseline" : "report";
// Bounds on failure only: the first start of a dev stack builds the app and seeds a profile.
const STACK_DEADLINE_MS = 6 * 60_000;
const TURN_DEADLINE_MS = 5 * 60_000;
// The idle samples are a measurement, not a check: one every 2 seconds, after the host settled.
const IDLE_SAMPLES = 5;
// `--idle-minutes=<n>`: how long the host stays idle after it settled, before the samples. Default 0.
const idleMinutes = Number(
  process.argv.find((argument) => argument.startsWith("--idle-minutes="))?.slice("--idle-minutes=".length) ?? "0",
);
if (!Number.isFinite(idleMinutes) || idleMinutes < 0) throw new Error("--idle-minutes must be a number of minutes.");
// A page on this computer, so the check needs no outside site. The title is new on each run.
const PAGE_TITLE = `Headless server check ${randomBytes(3).toString("hex")}`;
const NAME_PREFIX = "Headless E2E";

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

interface HostProcess {
  pid: number;
  ppid: number;
  rssMb: number;
  cpuPercent: number;
  kind: string;
}

const cdpTargetList = z.array(z.object({ type: z.string(), url: z.string(), title: z.string() }));
type CdpTarget = z.infer<typeof cdpTargetList>[number];

interface Report {
  mode: string;
  startedAt: string;
  transport: "http" | "webrtc";
  passed?: boolean;
  checks: Check[];
  unverified: string[];
  host?: { pid: number; rendererPort: number; remoteDebuggingPort: number };
  hostTargets?: CdpTarget[];
  idle?: { minutes: number; samples: ProcessSummary[]; processes: HostProcess[] };
  agent?: { id: string; provider: string; model: string | null };
  screenshot?: string;
  error?: string;
}

const logger = createOpenBotLogger("headless-server-e2e");
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => {
  checks.push({ name, passed, detail });
  logger.info(`${passed ? "PASS" : "FAIL"} ${name}`);
};
const until = async <T>(what: string, deadlineMs: number, read: () => Promise<T | null | undefined>): Promise<T> => {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const value = await read().catch(() => null);
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
};

const ownRecords = () => readDevInstanceRecords().filter((record) => resolve(record.projectRoot) === ROOT);

/** Each process under the host's Electron main process, with what kind of Chromium process it is. */
function hostProcesses(hostPid: number): HostProcess[] {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/u.exec(line);
      if (!match) return [];
      const [, pid, ppid, rss, cpu, command] = match;
      return [{ pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), cpu: Number(cpu), command: command ?? "" }];
    });
  const tree = new Set([hostPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (!tree.has(row.pid) && tree.has(row.ppid)) {
        tree.add(row.pid);
        grew = true;
      }
    }
  }
  return rows
    .filter((row) => tree.has(row.pid))
    .map((row) => {
      const type = /--type=([\w-]+)/u.exec(row.command)?.[1];
      const service = /--utility-sub-type=([\w.]+)/u.exec(row.command)?.[1];
      const kind =
        row.pid === hostPid
          ? "main"
          : type === "utility"
            ? `utility:${service ?? "unknown"}`
            : (type ?? `provider:${basename(row.command.split(" ")[0] ?? "unknown")}`);
      return {
        pid: row.pid,
        ppid: row.ppid,
        rssMb: Math.round(row.rssKb / 102.4) / 10,
        cpuPercent: row.cpu,
        kind,
      };
    });
}

async function cdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return cdpTargetList.parse(await response.json()).map(({ type, url, title }) => ({ type, url, title }));
}

/**
 * The Electron main process of a dev instance: the one that runs `out-dev-*\/main/start.js`. The record
 * can name it or a parent of it.
 */
function electronMainPid(record: DevInstanceRecord): number {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }] : [];
    });
  // Not the `electron-vite` launcher, which names the same entry: the Electron binary itself.
  const isMain = (command: string) =>
    /(MacOS\/Electron|\/electron) .*main\/start\.js/u.test(command) && !command.includes("--type=");
  const queue = [record.pid];
  while (queue.length > 0) {
    const pid = queue.shift() ?? 0;
    if (isMain(rows.find((row) => row.pid === pid)?.command ?? "")) return pid;
    for (const child of rows.filter((row) => row.ppid === pid)) queue.push(child.pid);
  }
  throw new Error(`No Electron main process under ${record.pid}.`);
}

/** The app's own processes, and all of them with the provider CLIs that the host started. */
interface ProcessSummary {
  appProcessCount: number;
  appRssMb: number;
  appCpuPercent: number;
  processCount: number;
  rssMb: number;
  cpuPercent: number;
  byKind: { kind: string; count: number; rssMb: number }[];
}

const summarize = (processes: HostProcess[]): ProcessSummary => {
  const byKind: ProcessSummary["byKind"] = [];
  for (const item of processes) {
    let entry = byKind.find((candidate) => candidate.kind === item.kind);
    if (!entry) {
      entry = { kind: item.kind, count: 0, rssMb: 0 };
      byKind.push(entry);
    }
    entry.count += 1;
    entry.rssMb = Math.round((entry.rssMb + item.rssMb) * 10) / 10;
  }
  const app = processes.filter((item) => !item.kind.startsWith("provider:"));
  const total = (items: HostProcess[], field: "rssMb" | "cpuPercent") =>
    Math.round(items.reduce((sum, item) => sum + item[field], 0) * 10) / 10;
  return {
    appProcessCount: app.length,
    appRssMb: total(app, "rssMb"),
    appCpuPercent: total(app, "cpuPercent"),
    processCount: processes.length,
    rssMb: total(processes, "rssMb"),
    cpuPercent: total(processes, "cpuPercent"),
    byKind,
  };
};

mkdirSync(OUT, { recursive: true });
assert.equal(ownRecords().length, 0, "A dev stack of this worktree already runs. Stop it with `bun run dev:stop`.");
if (allowMutations && !baseline) {
  assertMutationAllowed({
    command: "headless-server-e2e",
    allowMutations,
    instanceNamed: true,
    target: "the test client that this script starts",
  });
}

const stackLog = openSync(resolve(OUT, `${label}-stack.log`), "w");
const stack = spawn("bun", ["scripts/dev-services.ts", "test-client"], {
  cwd: ROOT,
  env: {
    ...process.env,
    OPENBOT_DEV_HEADLESS_SERVER: baseline ? "0" : "1",
    OPENBOT_DEV_CLIENT_TRANSPORT: transport,
  },
  stdio: ["ignore", stackLog, stackLog],
  detached: true,
});
stack.unref();
logger.info(`Started the dev stack (supervisor ${stack.pid}). Its output is in ${label}-stack.log.`);

const report: Report = {
  mode: baseline ? "baseline: the host loads the app page, as every server before this change" : "headless server",
  startedAt: new Date().toISOString(),
  transport,
  checks,
  unverified: [
    "The packaged Linux server: this run is a macOS dev host, whose app page comes from the Vite dev server. The start path is the same one that `OPENBOT_SERVER=1` and `OPENBOT_HOSTED_SERVER=1` take.",
    "The Dynamic Island: a dev build starts with it off, so this run cannot show that a server skips it.",
  ],
};
let passed = false;
let stopPageServer = () => {};
try {
  const [host, client] = await until("the host and the test client to start", STACK_DEADLINE_MS, async () => {
    const records = ownRecords();
    const app = records.find((record) => record.service === "app");
    const testClient = records.find((record) => record.service === "test-client");
    if (!app || !testClient) return null;
    await cdpTargets(app.remoteDebuggingPort);
    await cdpTargets(testClient.remoteDebuggingPort);
    return [app, testClient] as const;
  });
  const hostPid = electronMainPid(host);
  report.host = { pid: hostPid, rendererPort: host.rendererPort, remoteDebuggingPort: host.remoteDebuggingPort };

  // The test client's window opens after its process, so the first connections can find no window.
  const session = await until("the test client's window", STACK_DEADLINE_MS, () =>
    connectToDevApp(client.remoteDebuggingPort, logger, {
      expectedRendererPort: client.rendererPort,
      ownerPid: client.pid,
    }),
  );
  const page = session.page;
  const server = await until("the test client to reach the host", STACK_DEADLINE_MS, async () => {
    const servers = await page.evaluate(() => window.openbot.servers.list());
    return servers.find((item) => item.kind === "remote" && item.state === "online");
  });
  check("the test client is joined to the host and the host is online", true, {
    name: server.name,
    role: server.role,
  });
  const serverId = server.id;
  const agents = await page.evaluate((id) => window.openbot.agent.listAgents(id), serverId);
  check("the test client lists the host's agents over the Team API", agents.length > 0, {
    count: agents.length,
    names: agents.map((agent) => agent.name),
  });

  // The window of a server has no app page: no target of the renderer dev server, except the WebRTC bridge.
  const targets = await cdpTargets(host.remoteDebuggingPort);
  const appPages = targets.filter(
    (target) =>
      target.type === "page" &&
      new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${host.rendererPort}/`, "u").test(target.url) &&
      !target.url.includes("team-webrtc"),
  );
  report.hostTargets = targets;
  if (baseline) check("the baseline host loaded the app page", appPages.length > 0, appPages);
  else check("the host loaded no app page", appPages.length === 0, appPages);
  check(
    "the host keeps its WebRTC bridge page",
    targets.some((target) => target.url.includes("team-webrtc")),
    targets.filter((target) => target.url.includes("team-webrtc")).map((target) => target.url),
  );

  const samples: ProcessSummary[] = [];
  let lastProcesses: HostProcess[] = [];
  // Idle: the app processes, without the provider CLIs, use under 5% of a core for 3 readings in a row.
  // The provider CLIs list their models after the start; they are the same with and without the change.
  const appCpu = (processes: HostProcess[]) =>
    processes.filter((item) => !item.kind.startsWith("provider:")).reduce((sum, item) => sum + item.cpuPercent, 0);
  let quiet = 0;
  await until("the host to settle", STACK_DEADLINE_MS, async () => {
    quiet = appCpu(hostProcesses(hostPid)) < 5 ? quiet + 1 : 0;
    return quiet >= 3 ? true : null;
  });
  // A measurement, not a check: the app page grows while it runs, so a longer idle shows more of it.
  if (idleMinutes > 0) await new Promise((resolveWait) => setTimeout(resolveWait, idleMinutes * 60_000));
  for (let index = 0; index < IDLE_SAMPLES; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    lastProcesses = hostProcesses(hostPid);
    samples.push(summarize(lastProcesses));
  }
  report.idle = { minutes: idleMinutes, samples, processes: lastProcesses };
  check("the host process tree was measured while idle", lastProcesses.length > 0, samples.at(-1));

  if (allowMutations && !baseline) {
    const pageServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>${PAGE_TITLE}</title><h1>${PAGE_TITLE}</h1>`);
    });
    await new Promise<void>((resolveListen) => pageServer.listen(0, "127.0.0.1", resolveListen));
    const address = pageServer.address();
    assert.ok(address && typeof address === "object");
    const pageUrl = `http://127.0.0.1:${address.port}/`;
    stopPageServer = () => pageServer.close();
    // An earlier run that stopped before its cleanup left its agent.
    const leftovers = canAdministerServer(server.role)
      ? agents.filter((agent) => agent.name.startsWith(NAME_PREFIX))
      : [];
    for (const leftover of leftovers) {
      await page.evaluate(([agentId, id]) => window.openbot.agent.deleteAgent(agentId, id), [
        leftover.id,
        serverId,
      ] as const);
    }
    const created = await page.evaluate(
      ([id, chosen, url, prefix]) =>
        window.openbot.agent.createAgent(
          {
            name: `${prefix} ${Date.now()}`,
            description: "Made by scripts/headless-server-e2e.ts. Safe to delete.",
            avatarSeed: "headless-e2e",
            avatarHue: null,
            initialMessage: `Open ${url} in your OpenBot browser. Then reply with only the title of the page.`,
            ...(chosen ? { provider: chosen } : {}),
          },
          id,
        ),
      [serverId, chosenProvider, pageUrl, NAME_PREFIX] as const,
    );
    report.agent = { id: created.id, provider: created.provider, model: created.model };
    try {
      const reply = await until("the agent's reply", TURN_DEADLINE_MS, async () => {
        const conversation = await page.evaluate(
          ([agentId, id]) => window.openbot.agent.readConversation(agentId, id),
          [created.id, serverId] as const,
        );
        const answer = conversation.messages.find(
          (message) =>
            message.author === "assistant" && message.status === "completed" && message.text.includes(PAGE_TITLE),
        );
        return answer ? answer.text : null;
      });
      check("one agent turn on the host answers through the client", true, reply.slice(0, 200));
      const browserPage = (await cdpTargets(host.remoteDebuggingPort)).find((target) => target.url === pageUrl);
      check("the host's agent browser loaded the page", browserPage !== undefined, browserPage ?? null);
      await page.screenshot({ path: resolve(OUT, "client.png") });
      report.screenshot = resolve(OUT, "client.png");
    } finally {
      // Only an owner or an admin can delete an agent: over HTTP the test client is a member.
      if (!keep && canAdministerServer(server.role)) {
        await page.evaluate(([agentId, id]) => window.openbot.agent.deleteAgent(agentId, id), [
          created.id,
          serverId,
        ] as const);
      } else if (!keep) {
        report.unverified.push(`The agent ${created.name} stays on the host: a member cannot delete it.`);
      }
    }
  } else if (!baseline) {
    report.unverified = [...report.unverified, "An agent turn and the agent browser: run with --allow-mutations."];
  }
  await session.close();
  passed = checks.every((item) => item.passed);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  stopPageServer();
  report.passed = passed;
  writeFileSync(resolve(OUT, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`${passed ? "Passed" : "Failed"}. Wrote .openbot-build/headless-server-e2e/${label}.json`);
  if (!keep) {
    execFileSync("bun", ["scripts/dev-stack.ts", "stop"], { cwd: ROOT, stdio: "inherit" });
  }
}
process.exitCode = passed ? 0 : 1;
