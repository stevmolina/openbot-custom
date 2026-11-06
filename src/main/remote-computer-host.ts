import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  REMOTE_COMPUTER_ARGUMENTS_MAX_LENGTH,
  REMOTE_COMPUTER_CALL_EVENT,
  REMOTE_COMPUTER_STATE_INTERVAL_MS,
  REMOTE_COMPUTER_TOOL_MAX_LENGTH,
  type RemoteComputerCallEvent,
} from "@openbot/contracts/team-protocol/remote-computer-use-v1";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Duration, Effect, Schema } from "effect";
import { causeHelpers, runCauseEffect } from "../backend/effect-boundary";
import { readJsonBody } from "../backend/local-mcp-bridge";
import { remoteComputerMcpServerId } from "../backend/remote-computer-mcp";

// The host end of `remote-computer-use-v1`: Computer Use on a member's own computer, for the agents
// of that member on this host.
//
// A member's desktop app says that it is available (`setState`), from one session. The host then
// gives each agent that only that member can use an MCP entry for that computer: an http server on
// the loopback address, with a path and a bearer that name the computer and the agent. Each tool
// request on that server goes to the event connections of that session as a `remote-computer-call`,
// and waits for the app's answer on the reply route of the same session (`reply`). The host checks
// the computer and the agent again at each request, so an entry that a provider kept after a change
// stops working at once. Nothing is stored: a restart forgets every computer.

const logger = createOpenBotLogger("remote-computer-host");

/** A computer that sent no state for three intervals has gone to sleep or lost the network. */
const COMPUTER_EXPIRY_MS = REMOTE_COMPUTER_STATE_INTERVAL_MS * 3;
const SWEEP_INTERVAL_MS = 10_000;
/** A tool call that the computer does not answer in this time fails. */
const CALL_TIMEOUT_MS = 3 * 60_000;
/** The calls that can wait for one computer at the same time. */
const MAX_PENDING_CALLS = 8;
/** How long the tool list of a computer is kept, so a new provider session does not ask the computer again. */
const TOOL_LIST_TTL_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000;
/** The MCP server name of a member's first computer. A second one gets `_2`, and so on. */
const ENTRY_NAME = "my_computer";

export class RemoteComputerError extends Schema.TaggedError<RemoteComputerError>()("RemoteComputerError", {
  cause: Schema.Defect(),
}) {}

const { io: remoteComputerCall } = causeHelpers(RemoteComputerError);

/** What the Team API server lends the host: the event connections and the access rules of its members. */
export interface RemoteComputerHostLink {
  /** Sends a call to the event connections of one session that took the capability. False when there is none. */
  send(sessionId: string, event: RemoteComputerCallEvent): boolean;
  /**
   * The agents that may use this member's computer. Empty for a member that is not there, is
   * disabled, or shares the server with another enabled member.
   */
  agentsOnlyFor(memberId: string): readonly string[];
}

export interface RemoteComputerState {
  available: boolean;
  computerName: string;
}

export interface RemoteComputerReply {
  requestId: string;
  ok: boolean;
  payload: string;
}

interface Computer {
  readonly id: string;
  readonly memberId: string;
  readonly sessionId: string;
  readonly createdAt: number;
  name: string;
  seenAt: number;
  tools: { at: number; result: ListToolsResult } | null;
}

interface PendingCall {
  readonly computerId: string;
  readonly memberId: string;
  readonly sessionId: string;
  readonly result: Deferred.Deferred<unknown, RemoteComputerError>;
}

type Operation = { operation: "list-tools" } | { operation: "call-tool"; tool: string; arguments: string };

export class RemoteComputerHost {
  readonly #secret = randomBytes(32);
  /** By session: one session is one desktop app, so it is one computer. */
  readonly #computers = new Map<string, Computer>();
  readonly #pending = new Map<string, PendingCall>();
  readonly #listeners = new Set<() => void>();
  #link: RemoteComputerHostLink | null = null;
  #server: HttpServer | null = null;
  #port: number | null = null;
  #sweep: ReturnType<typeof setInterval> | null = null;
  #listening: Promise<void> | null = null;
  /** The entries last told to the listeners, as ids and names. */
  #emitted = "[]";
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  /** The Team API server starts. Until then no computer can say it is available. */
  attach(link: RemoteComputerHostLink): void {
    this.#link = link;
  }

  /** The Team API server stops: every computer goes, because no event connection is left to reach it. */
  detach(): void {
    this.#link = null;
    this.#clear();
  }

  /** Told when the entries change: a computer comes, goes or is renamed. Not for a repeated state. */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Whether any member's computer is available. */
  hasComputers(): boolean {
    return this.#computers.size > 0;
  }

  /** One entry for each pair of an available computer and an agent that only its member can use. */
  mcpServers(): McpServerConfig[] {
    const link = this.#link;
    const port = this.#port;
    if (!link || port === null) return [];
    const entries: McpServerConfig[] = [];
    const byMember = new Map<string, Computer[]>();
    for (const computer of this.#computers.values()) {
      const list = byMember.get(computer.memberId) ?? [];
      list.push(computer);
      byMember.set(computer.memberId, list);
    }
    for (const [memberId, computers] of byMember) {
      const agentIds = link.agentsOnlyFor(memberId);
      if (agentIds.length === 0) continue;
      computers.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
      computers.forEach((computer, index) => {
        const name = index === 0 ? ENTRY_NAME : `${ENTRY_NAME}_${index + 1}`;
        for (const agentId of agentIds)
          entries.push({
            id: remoteComputerMcpServerId(computer.id, agentId),
            name,
            transport: "http",
            enabled: true,
            command: "",
            args: [],
            env: [],
            envPassthrough: [],
            workingDirectory: "",
            url: `http://127.0.0.1:${port}/computer/${computer.id}/${encodeURIComponent(agentId)}`,
            headers: [{ key: "Authorization", value: `Bearer ${this.#bearer(computer.id, agentId)}` }],
          });
      });
    }
    return entries;
  }

  /** A desktop app says whether this host's agents may use its computer now. */
  readonly setState = Effect.fn("RemoteComputerHost.setState")(function* (
    this: RemoteComputerHost,
    memberId: string,
    sessionId: string,
    state: RemoteComputerState,
  ): Effect.fn.Return<void, RemoteComputerError> {
    const existing = this.#computers.get(sessionId);
    if (!state.available) {
      if (existing) this.#remove(existing, "The computer stopped sharing.");
      return;
    }
    const link = this.#link;
    if (!link) return yield* new RemoteComputerError({ cause: new Error("The host is not serving members.") });
    // A computer that no agent may use is not kept: nothing would use it, and each change of it
    // would refresh the agents of every member.
    if (link.agentsOnlyFor(memberId).length === 0) {
      if (existing) this.#remove(existing, "No agent may use the computer.");
      return;
    }
    const name = computerName(state.computerName);
    if (existing && existing.memberId === memberId) {
      existing.seenAt = this.#now();
      if (existing.name !== name) {
        existing.name = name;
        this.#emit();
      }
      return;
    }
    if (existing) this.#remove(existing, "The session changed members.");
    yield* this.#listen();
    // Another state of the same session can have added the computer while the server started.
    const raced = this.#computers.get(sessionId);
    if (raced?.memberId === memberId) {
      raced.seenAt = this.#now();
      raced.name = name;
      return;
    }
    if (raced) this.#remove(raced, "The session changed members.");
    const now = this.#now();
    this.#computers.set(sessionId, {
      id: randomUUID(),
      memberId,
      sessionId,
      createdAt: now,
      name,
      seenAt: now,
      tools: null,
    });
    this.#startSweep();
    this.#emit();
  }).bind(this);

  /**
   * The app's answer to one call. False when no call of this session and member has that id: a late
   * answer, or one from another session, which must not settle someone else's call.
   */
  reply(memberId: string, sessionId: string, reply: RemoteComputerReply): boolean {
    const pending = this.#pending.get(reply.requestId);
    if (!pending || pending.sessionId !== sessionId || pending.memberId !== memberId) return false;
    this.#pending.delete(reply.requestId);
    if (!reply.ok) {
      Deferred.doneUnsafe(
        pending.result,
        Effect.fail(
          new RemoteComputerError({ cause: new Error(reply.payload || "The computer refused the request.") }),
        ),
      );
      return true;
    }
    let value: unknown;
    try {
      value = JSON.parse(reply.payload);
    } catch {
      Deferred.doneUnsafe(
        pending.result,
        Effect.fail(new RemoteComputerError({ cause: new Error("The computer sent an answer that is not JSON.") })),
      );
      return true;
    }
    Deferred.doneUnsafe(pending.result, Effect.succeed(value));
    return true;
  }

  /**
   * The last event connection of a session closed. Its waiting calls fail at once; the computer stays
   * offered until its state expires, so a short reconnect does not change every agent's tools.
   */
  sessionDisconnected(sessionId: string): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.sessionId !== sessionId) continue;
      this.#pending.delete(requestId);
      Deferred.doneUnsafe(
        pending.result,
        Effect.fail(new RemoteComputerError({ cause: new Error("The computer disconnected.") })),
      );
    }
  }

  readonly stop = Effect.fn("RemoteComputerHost.stop")(function* (this: RemoteComputerHost) {
    this.#link = null;
    this.#clear();
    if (this.#sweep) clearInterval(this.#sweep);
    this.#sweep = null;
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (server)
      yield* Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      });
  }).bind(this);

  #clear(): void {
    const had = this.#computers.size > 0;
    for (const computer of [...this.#computers.values()]) this.#remove(computer, "The host stopped.", false);
    if (had) this.#emit();
  }

  #remove(computer: Computer, reason: string, emit = true): void {
    if (this.#computers.get(computer.sessionId) !== computer) return;
    this.#computers.delete(computer.sessionId);
    for (const [requestId, pending] of this.#pending) {
      if (pending.computerId !== computer.id) continue;
      this.#pending.delete(requestId);
      Deferred.doneUnsafe(pending.result, Effect.fail(new RemoteComputerError({ cause: new Error(reason) })));
    }
    if (emit) this.#emit();
  }

  /** Tells the listeners only when the entries changed, because each change refreshes every agent. */
  #emit(): void {
    const entries = JSON.stringify(this.mcpServers().map((entry) => [entry.id, entry.name]));
    if (entries === this.#emitted) return;
    this.#emitted = entries;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        logger.warn("A remote computer listener failed.", toLogValue(error));
      }
    }
  }

  #startSweep(): void {
    if (this.#sweep) return;
    this.#sweep = setInterval(() => {
      const cutoff = this.#now() - COMPUTER_EXPIRY_MS;
      for (const computer of [...this.#computers.values()])
        if (computer.seenAt < cutoff) this.#remove(computer, "The computer stopped answering.");
      if (this.#computers.size === 0 && this.#sweep) {
        clearInterval(this.#sweep);
        this.#sweep = null;
      }
    }, SWEEP_INTERVAL_MS);
    this.#sweep.unref?.();
  }

  #bearer(computerId: string, agentId: string): string {
    return createHmac("sha256", this.#secret).update(`${computerId}\u0000${agentId}`).digest("base64url");
  }

  /** Starts the loopback server once: two states that come together share one start. */
  #listen(): Effect.Effect<void, RemoteComputerError> {
    if (this.#server) return Effect.void;
    this.#listening ??= runCauseEffect(this.#open()).finally(() => {
      this.#listening = null;
    });
    const listening = this.#listening;
    return remoteComputerCall(() => listening);
  }

  #open(): Effect.Effect<void, RemoteComputerError> {
    return Effect.callback<void, RemoteComputerError>((resume) => {
      const server = createServer((request, response) => {
        void runCauseEffect(this.#handle(request, response)).catch((error) => {
          logger.warn("A remote computer request failed.", toLogValue(error));
          if (!response.headersSent) {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "internal" }));
          }
        });
      });
      const failed = (cause: Error) => resume(Effect.fail(new RemoteComputerError({ cause })));
      server.once("error", failed);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", failed);
        const address = server.address();
        if (!address || isString(address)) {
          server.close();
          resume(Effect.fail(new RemoteComputerError({ cause: new Error("The remote computer server has no port.") })));
          return;
        }
        this.#server = server;
        this.#port = address.port;
        resume(Effect.void);
      });
    });
  }

  /**
   * The computer and agent that a request names, when its bearer is theirs. `computer` is null when
   * the computer is gone or the agent may no longer use it: the request is then answered with a tool
   * error, not 401, which an MCP client could take as a sign-in to start.
   */
  #authorize(request: IncomingMessage): { computer: Computer | null; agentId: string } | null {
    const link = this.#link;
    if (!link) return null;
    const match = /^\/computer\/([0-9a-f-]{36})\/([^/?#]+)$/u.exec(new URL(request.url ?? "/", "http://x").pathname);
    if (!match?.[1] || !match[2]) return null;
    let agentId: string;
    try {
      agentId = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const candidate = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.#bearer(match[1], agentId));
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null;
    const computer = [...this.#computers.values()].find((entry) => entry.id === match[1]);
    if (!computer || !link.agentsOnlyFor(computer.memberId).includes(agentId)) return { computer: null, agentId };
    return { computer, agentId };
  }

  readonly #handle = Effect.fn("RemoteComputerHost.handle")(function* (
    this: RemoteComputerHost,
    request: IncomingMessage,
    response: ServerResponse,
  ): Effect.fn.Return<void, RemoteComputerError> {
    const target = this.#authorize(request);
    if (!target) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }
    const { computer } = target;
    // The provider stopped waiting: the turn was stopped, or its request closed. The call stops too.
    const closed = new AbortController();
    response.once("close", () => closed.abort());
    const mcp = new Server(
      { name: "openbot-remote-computer", version: "1.0.0" },
      {
        capabilities: { tools: {} },
        instructions:
          `These tools use Computer Use on ${computer ? `"${computer.name}"` : "a computer"}, the computer of ` +
          "the person who owns this agent, and not on the server that runs the agent. They see and control " +
          "that computer's screen.",
      },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, (_request, extra) =>
      computer
        ? runCauseEffect(this.#listTools(computer, AbortSignal.any([closed.signal, extra.signal])))
        : Promise.resolve<ListToolsResult>({ tools: [] }),
    );
    mcp.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
      runCauseEffect(
        (computer
          ? this.#callTool(
              computer,
              params.name,
              params.arguments ?? {},
              AbortSignal.any([closed.signal, extra.signal]),
            )
          : Effect.fail(new RemoteComputerError({ cause: new Error("The computer is not available now.") }))
        ).pipe(
          Effect.catch(({ cause }) =>
            Effect.succeed<CallToolResult>({
              isError: true,
              content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
            }),
          ),
        ),
      ),
    );
    const transport = new StreamableHTTPServerTransport({});
    yield* Effect.gen(function* () {
      yield* remoteComputerCall(() => mcp.connect(transport));
      const body = yield* readJsonBody(request, MAX_BODY_BYTES).pipe(
        Effect.mapError(({ cause }) => new RemoteComputerError({ cause })),
      );
      yield* remoteComputerCall(() => transport.handleRequest(request, response, body));
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          await transport.close().catch(() => undefined);
          await mcp.close().catch(() => undefined);
        }),
      ),
    );
  });

  readonly #listTools = Effect.fn("RemoteComputerHost.listTools")(function* (
    this: RemoteComputerHost,
    computer: Computer,
    signal: AbortSignal,
  ): Effect.fn.Return<ListToolsResult, RemoteComputerError> {
    if (computer.tools && this.#now() - computer.tools.at < TOOL_LIST_TTL_MS) return computer.tools.result;
    const value = yield* this.#call(computer, { operation: "list-tools" }, signal);
    const parsed = ListToolsResultSchema.safeParse(value);
    if (!parsed.success)
      return yield* new RemoteComputerError({ cause: new Error("The computer sent a tool list that is not valid.") });
    computer.tools = { at: this.#now(), result: parsed.data };
    return parsed.data;
  });

  readonly #callTool = Effect.fn("RemoteComputerHost.callTool")(function* (
    this: RemoteComputerHost,
    computer: Computer,
    tool: string,
    input: unknown,
    signal: AbortSignal,
  ): Effect.fn.Return<CallToolResult, RemoteComputerError> {
    const text = JSON.stringify(input ?? {});
    // The app refuses a longer call as a malformed event, which would end its whole connection.
    if (tool.length > REMOTE_COMPUTER_TOOL_MAX_LENGTH || text.length > REMOTE_COMPUTER_ARGUMENTS_MAX_LENGTH)
      return yield* new RemoteComputerError({ cause: new Error("The tool request is too large for the computer.") });
    const value = yield* this.#call(computer, { operation: "call-tool", tool, arguments: text }, signal);
    const parsed = CallToolResultSchema.safeParse(value);
    if (!parsed.success)
      return yield* new RemoteComputerError({ cause: new Error("The computer sent a tool result that is not valid.") });
    return parsed.data;
  });

  readonly #call = Effect.fn("RemoteComputerHost.call")(function* (
    this: RemoteComputerHost,
    computer: Computer,
    operation: Operation,
    signal: AbortSignal,
  ): Effect.fn.Return<unknown, RemoteComputerError> {
    const link = this.#link;
    if (!link || this.#computers.get(computer.sessionId) !== computer)
      return yield* new RemoteComputerError({ cause: new Error(`"${computer.name}" is not available now.`) });
    const waiting = [...this.#pending.values()].filter((pending) => pending.computerId === computer.id).length;
    if (waiting >= MAX_PENDING_CALLS)
      return yield* new RemoteComputerError({ cause: new Error(`"${computer.name}" is busy. Try again.`) });
    const requestId = randomUUID();
    const result = Deferred.makeUnsafe<unknown, RemoteComputerError>();
    this.#pending.set(requestId, {
      computerId: computer.id,
      memberId: computer.memberId,
      sessionId: computer.sessionId,
      result,
    });
    const event: RemoteComputerCallEvent =
      operation.operation === "list-tools"
        ? { type: REMOTE_COMPUTER_CALL_EVENT, requestId, operation: "list-tools" }
        : {
            type: REMOTE_COMPUTER_CALL_EVENT,
            requestId,
            operation: "call-tool",
            tool: operation.tool,
            arguments: operation.arguments,
          };
    if (!link.send(computer.sessionId, event)) {
      this.#pending.delete(requestId);
      return yield* new RemoteComputerError({ cause: new Error(`"${computer.name}" is not connected now.`) });
    }
    // A cancelled call stops waiting and frees its slot. The computer may still finish the action it
    // already started; its late answer is not taken.
    const cancel = () => {
      if (!this.#pending.delete(requestId)) return;
      Deferred.doneUnsafe(
        result,
        Effect.fail(new RemoteComputerError({ cause: new Error("The request was cancelled.") })),
      );
    };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    return yield* Deferred.await(result).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(CALL_TIMEOUT_MS),
        orElse: () =>
          Effect.fail(new RemoteComputerError({ cause: new Error(`"${computer.name}" did not answer in time.`) })),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          signal.removeEventListener("abort", cancel);
          this.#pending.delete(requestId);
        }),
      ),
    );
  });
}

/** The name the agent reads: printable text, at most 64 units, or a plain word when nothing is left. */
function computerName(value: string): string {
  const cleaned = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 64);
  return cleaned || "Computer";
}
