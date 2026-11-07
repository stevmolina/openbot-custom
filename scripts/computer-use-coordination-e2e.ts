// Runs the real Computer Use turn-taking of the main process: `CuaDriverActionTap`, which every
// provider's driver proxy connects to, with the real `ComputerUseCoordinator` and the real refusal
// text. Only the driver daemon is a stand-in, at its socket: a server that speaks the daemon's line
// protocol, takes a while over each input action, and records when each one ran. So the test needs
// no screen grants and runs on any computer.
//
// Each actor talks to the tap the way the driver proxy does: one connection for each request, on the
// address of its own conversation. It checks that input actions run one at a time and in the order
// asked; that a read does not wait; that an app another conversation holds is refused, with the
// holder named, at once for a key press and after a bounded wait for a click; that a claim ends with
// the holder's turn and after its idle time; and that a request whose agent gives up leaves no lease.
//
// `bun scripts/computer-use-coordination-e2e.ts`. Writes .openbot-build/computer-use-coordination-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import {
  type ComputerUseActorDirectory,
  computerUseActorLabel,
  computerUseRefusalText,
} from "../src/main/computer-use-actors";
import {
  ComputerUseCoordinator,
  type ComputerUseCoordinatorEvent,
  computerUseActor,
} from "../src/main/computer-use-coordinator";
import { CuaDriverActionTap } from "../src/main/cua-driver-action-tap";

const OUT = resolve(import.meta.dirname, "../.openbot-build/computer-use-coordination-e2e");
/** How long the stand-in daemon takes over one input action. */
const ACTION_MS = 120;
const CLAIM_WAIT_MS = 600;
const CLAIM_IDLE_MS = 1_500;
const TEXT_EDIT = 101;
const NOTES = 202;
const CALCULATOR = 303;
const MAIL = 404;

const logger = createOpenBotLogger("computer-use-coordination-e2e");
const checks: Array<{ name: string; detail?: unknown }> = [];
function pass(name: string, detail?: unknown): void {
  checks.push(detail === undefined ? { name } : { name, detail });
  logger.info(`ok - ${name}`);
}

/** One JSON line, as a record, or an empty one when it is not an object. */
function readLine(line: string): DynamicRecord {
  const parsed = JSON.parse(line);
  return isDynamicRecord(parsed) ? parsed : {};
}

/** A record field as text, or `""`. */
function text(record: unknown, key: string): string {
  return isDynamicRecord(record) && typeof record[key] === "string" ? record[key] : "";
}

/** One request that reached the stand-in daemon: which actor, which tool, and when it ran. */
interface DaemonCall {
  tool: string;
  marker: string;
  start: number;
  end: number;
}

const started = Date.now();
const elapsed = () => Date.now() - started;

const directory = await mkdtemp(join(tmpdir(), "obcu-"));
const daemonAddress = join(directory, "driver.sock");
const tapAddress = join(directory, "tap.sock");

// The stand-in daemon. A read answers at once; an input action takes `ACTION_MS`. It counts how many
// input actions run at the same time, which the lease must keep at one.
const calls: DaemonCall[] = [];
let inputsInFlight = 0;
let maxInputsInFlight = 0;
const daemon = createServer((socket) => {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      const request = readLine(line);
      const method = text(request, "method");
      const tool = text(request, "name") || method;
      const read = tool === "get_window_state" || method !== "call";
      const args = request.args;
      const call: DaemonCall = { tool, marker: text(args, "marker"), start: elapsed(), end: 0 };
      const answer = () => {
        call.end = elapsed();
        calls.push(call);
        const result = {
          ok: true,
          result: { content: [{ type: "text", text: `${tool} done` }], structuredContent: { effect: "applied" } },
        };
        socket.write(`${JSON.stringify(result)}\n`);
      };
      if (read) {
        answer();
        continue;
      }
      inputsInFlight += 1;
      maxInputsInFlight = Math.max(maxInputsInFlight, inputsInFlight);
      setTimeout(() => {
        inputsInFlight -= 1;
        answer();
      }, ACTION_MS);
    }
  });
});
await new Promise<void>((done) => daemon.listen(daemonAddress, done));

// Real names, as the main process reads them from the agent service.
const agents = {
  ada: { name: "Ada", color: "#2f6fed" as const, chatThreadId: "thread-ada-chat" },
  grace: { name: "Grace", color: null, chatThreadId: "thread-grace-chat" },
};
const actorDirectory: ComputerUseActorDirectory = {
  agent: (agentId) => (agentId === "agent-ada" ? agents.ada : agentId === "agent-grace" ? agents.grace : null),
  threadTitle: (_agentId, threadId) => (threadId === "thread-grace-task" ? "Compare prices" : null),
};
const appNames = new Map([
  [TEXT_EDIT, "TextEdit"],
  [NOTES, "Notes"],
  [CALCULATOR, "Calculator"],
  [MAIL, "Mail"],
]);

const events: Array<ComputerUseCoordinatorEvent & { at: number }> = [];
const coordinator = new ComputerUseCoordinator({
  claimWaitMs: CLAIM_WAIT_MS,
  claimIdleMs: CLAIM_IDLE_MS,
  leaseWaitMs: 10_000,
});
coordinator.onEvent((event) => events.push({ ...event, at: elapsed() }));
const tap = new CuaDriverActionTap({
  coordinator,
  refusalText: (refused) =>
    computerUseRefusalText(actorDirectory, (pid) => Effect.succeed(appNames.get(pid) ?? null), refused),
  maxSocketPathLength: 103,
});
await Effect.runPromise(tap.listen({ upstream: daemonAddress, tap: tapAddress }));

// Ada works in her own chat; Grace works in a side thread. Each gets an address of its own.
const ada = computerUseActor("agent-ada", "thread-ada-chat");
const grace = computerUseActor("agent-grace", "thread-grace-task");
const adaAddress = tap.actorAddress(ada);
const graceAddress = tap.actorAddress(grace);
assert.ok(adaAddress && graceAddress, "each conversation gets an address");
assert.notEqual(adaAddress, graceAddress);
assert.equal(tap.actorAddress(computerUseActor("agent-ada", "thread-ada-chat")), adaAddress);
assert.equal(computerUseActor("agent-ada", "thread-ada-chat").key, ada.key);
pass("each conversation has its own address, the same at each read", { ada: adaAddress, grace: graceAddress });

interface Answer {
  text: string;
  isError: boolean;
  structured: boolean;
  ms: number;
}

/** One request on a connection of its own, as the driver proxy sends it. */
function send(address: string, tool: string, args: DynamicRecord): Promise<Answer> {
  const at = Date.now();
  return new Promise((resolveAnswer, reject) => {
    const socket = connect(address);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const answer = readLine(buffer.slice(0, newline));
      const result = isDynamicRecord(answer.result) ? answer.result : {};
      const content = Array.isArray(result.content) ? result.content : [];
      socket.end();
      resolveAnswer({
        text: text(content[0], "text"),
        isError: result.isError === true,
        structured: result.structuredContent !== undefined,
        ms: Date.now() - at,
      });
    });
    socket.on("error", reject);
    socket.write(`${JSON.stringify({ method: "call", name: tool, args, session_id: "mcp-e2e" })}\n`);
  });
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// 1. The lease: six clicks from two conversations on two apps, asked at nearly the same time.
const order: string[] = [];
const clicks: Array<Promise<Answer>> = [];
for (let index = 0; index < 3; index += 1) {
  for (const [name, address, pid] of [
    ["ada", adaAddress, TEXT_EDIT],
    ["grace", graceAddress, NOTES],
  ] as const) {
    const marker = `${name}-${index}`;
    order.push(marker);
    clicks.push(send(address, "click", { pid, x: 10 + index, y: 20, marker }));
    await sleep(5);
  }
}
// A read while the clicks queue: it takes no lease, so it does not wait behind them.
await sleep(20);
const read = await send(graceAddress, "get_window_state", { pid: NOTES, marker: "grace-read" });
const clickAnswers = await Promise.all(clicks);
assert.ok(
  clickAnswers.every((answer) => !answer.isError),
  "every click ran",
);
assert.equal(maxInputsInFlight, 1, "input actions never overlap");
const ran = calls.filter((call) => call.tool === "click").map((call) => call.marker);
assert.deepEqual(ran, order, "input actions run in the order they were asked");
const readCall = calls.find((call) => call.marker === "grace-read");
const lastClick = calls.filter((call) => call.tool === "click").at(-1);
assert.ok(readCall && lastClick && readCall.end < lastClick.end, "the read finished before the queued clicks");
assert.ok(read.ms < ACTION_MS, `the read did not wait for the lease (${read.ms} ms)`);
// The agent reads the JSON copy of the structured result that the tap adds to a tool answer.
assert.ok(clickAnswers[0]?.structured);
pass("input actions take turns one at a time, first in first out, and a read does not wait", {
  order: ran,
  readMs: read.ms,
  maxInputsInFlight,
});

// 2. An app claim: Ada clicked in TextEdit, so a key press from Grace there is refused at once.
const typed = await send(graceAddress, "type_text", { pid: TEXT_EDIT, text: "hello", marker: "grace-type" });
assert.equal(typed.isError, true);
assert.equal(typed.structured, false, "a refusal carries no structured result to check against a schema");
const adaLabel = computerUseActorLabel(actorDirectory, ada);
assert.equal(
  typed.text,
  `TextEdit is in use by ${adaLabel.agent} (${adaLabel.thread}). Try again later or use another app.`,
);
assert.ok(typed.ms < CLAIM_WAIT_MS / 2, `a key press is refused at once (${typed.ms} ms)`);
assert.ok(!calls.some((call) => call.marker === "grace-type"), "the refused key press never reached the daemon");
pass("a key press into an app another conversation holds is refused at once, naming the holder", {
  text: typed.text,
  ms: typed.ms,
});

// 3. A click there waits up to the bounded time, then is refused with the same reason.
const waitedClick = await send(graceAddress, "click", { pid: TEXT_EDIT, x: 1, y: 1, marker: "grace-click-wait" });
assert.equal(waitedClick.isError, true);
assert.match(waitedClick.text, /^TextEdit is in use by Ada \(own chat\)\./);
assert.ok(
  waitedClick.ms >= CLAIM_WAIT_MS - 20 && waitedClick.ms < CLAIM_WAIT_MS + 1_000,
  `a click waits the bounded time (${waitedClick.ms} ms)`,
);
pass("a click into a held app waits the bounded time, then is refused", { ms: waitedClick.ms });

// 4. Ada's turn ends: her claim ends with it, and Grace works in TextEdit at once.
coordinator.turnEnded("agent-ada", "thread-ada-chat");
const afterTurn = await send(graceAddress, "type_text", { pid: TEXT_EDIT, text: "hello", marker: "grace-type-2" });
assert.equal(afterTurn.isError, false);
pass("the claim ends with the holder's turn", { ms: afterTurn.ms });

// 5. A waiting click wakes as soon as the holder's turn ends, rather than at its deadline.
const waiting = send(adaAddress, "click", { pid: TEXT_EDIT, x: 2, y: 2, marker: "ada-click-woken" });
await sleep(150);
coordinator.turnEnded("agent-grace", "thread-grace-task");
const woken = await waiting;
assert.equal(woken.isError, false);
assert.ok(woken.ms < CLAIM_WAIT_MS, `the waiting click woke at the turn end (${woken.ms} ms)`);
pass("a waiting click runs as soon as the holder's turn ends", { ms: woken.ms });

// 6. A claim with no action for its idle time ends by itself.
await send(graceAddress, "click", { pid: CALCULATOR, x: 3, y: 3, marker: "grace-calculator" });
const held = await send(adaAddress, "press_key", { pid: CALCULATOR, key: "1", marker: "ada-calculator-early" });
assert.equal(held.isError, true);
assert.match(held.text, /^Calculator is in use by Grace \(Compare prices\)\./, "a side thread is named by its title");
await sleep(CLAIM_IDLE_MS + 100);
const idle = await send(adaAddress, "press_key", { pid: CALCULATOR, key: "1", marker: "ada-calculator-late" });
assert.equal(idle.isError, false);
assert.ok(events.some((event) => event.type === "claim-ended" && event.why === "idle"));
pass("a claim ends after its idle time", { idleMs: CLAIM_IDLE_MS });

// 7. An agent that gives up while it waits leaves the queue, and holds no lease afterwards.
coordinator.turnEnded("agent-ada", "thread-ada-chat");
const slow = send(adaAddress, "click", { pid: MAIL, x: 4, y: 4, marker: "ada-mail" });
await sleep(10);
const abandoned = connect(graceAddress);
abandoned.write(
  `${JSON.stringify({ method: "call", name: "click", args: { pid: NOTES, x: 5, y: 5, marker: "grace-gave-up" } })}\n`,
);
await sleep(20);
abandoned.destroy();
await slow;
const next = await send(graceAddress, "click", { pid: NOTES, x: 6, y: 6, marker: "grace-after" });
assert.equal(next.isError, false);
assert.ok(next.ms < ACTION_MS * 3, `the next action did not wait for a lost lease (${next.ms} ms)`);
assert.ok(!calls.some((call) => call.marker === "grace-gave-up"), "the abandoned request never reached the daemon");
assert.equal(coordinator.leaseHolder(), null, "no lease is left held");
pass("a request whose agent gives up leaves the queue and no lease", { nextMs: next.ms });

// 8. The tap draws one cursor for each conversation that aimed the pointer.
const pointers = tap.pointers(60_000).map((entry) => entry.actor.key);
assert.ok(pointers.includes(ada.key) && pointers.includes(grace.key));
pass("each conversation keeps its own cursor point", { cursors: pointers.length });

assert.equal(maxInputsInFlight, 1, "input actions never overlapped during the whole run");

await Effect.runPromise(tap.close());
await new Promise<void>((done) => daemon.close(() => done()));
await rm(directory, { recursive: true, force: true });

await mkdir(OUT, { recursive: true });
const report = {
  ok: true,
  checks,
  daemonCalls: calls,
  coordinatorEvents: events,
  settings: { actionMs: ACTION_MS, claimWaitMs: CLAIM_WAIT_MS, claimIdleMs: CLAIM_IDLE_MS },
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`${checks.length} checks passed. Report: ${join(OUT, "report.json")}`);
process.exit(0);
