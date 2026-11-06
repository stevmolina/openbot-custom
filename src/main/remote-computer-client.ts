import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type CallToolResult,
  CallToolResultSchema,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig, RemoteComputerServer, RemoteComputerSession } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  REMOTE_COMPUTER_REPLY_MAX_LENGTH,
  REMOTE_COMPUTER_STATE_INTERVAL_MS,
  REMOTE_COMPUTER_USE_ROUTES,
  type RemoteComputerCallEvent,
} from "@openbot/contracts/team-protocol/remote-computer-use-v1";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { RemoteWorkflowError } from "./remote-service-effects";

// The desktop end of `remote-computer-use-v1`: the agents of a joined server use Computer Use on this
// computer, when the user turned that on for that server.
//
// While the switch is on, the server is connected and this computer's own Computer Use has its
// grants, the app tells the host that the computer is available, and repeats it. Each
// `remote-computer-call` from that host runs on this computer's driver, through one MCP connection
// of OpenBot's own, and the answer goes back on the reply route. A call from a server whose switch
// is off is refused here too, so a host cannot use a computer that the user did not offer.
//
// What the user sees: OpenBot's own agent cursor and rim, because the calls go through the same tap
// as a local agent's, and the sessions list below, which the window shows with a Stop button.

const logger = createOpenBotLogger("remote-computer-client");

/**
 * Tools that change the driver itself or OpenBot's copy of it, not the desktop: its settings, its
 * updates, its extensions, and its recordings, which write files and replay earlier sessions. An
 * agent on another computer does not get them.
 */
const BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "set_config",
  "check_for_update",
  "install_extension",
  "install_ffmpeg",
  "start_recording",
  "stop_recording",
  "replay_trajectory",
  "set_agent_cursor_theme",
]);

/**
 * The long edge of a screenshot that the app sends, when the agent asks for none. The driver maps the
 * coordinates of a smaller picture back to the screen, so an agent clicks the same place.
 */
const DEFAULT_IMAGE_DIMENSION = 1568;
const JPEG_QUALITIES = [80, 65, 50, 35] as const;
/** A server stays in the sessions list this long after its last request. */
const SESSION_IDLE_MS = 45_000;
const SESSION_CHECK_MS = 5_000;
const CALL_TIMEOUT_MS = 2 * 60_000;

export class RemoteComputerClientError extends Schema.TaggedError<RemoteComputerClientError>()(
  "RemoteComputerClientError",
  { cause: Schema.Defect() },
) {}

const { io: clientCall } = causeHelpers(RemoteComputerClientError);

/** The two bodies that `remote-computer-use-v1` sends: the state, and the answer to one call. */
export type RemoteComputerBody =
  | { available: boolean; computerName: string }
  | { requestId: string; ok: boolean; payload: string };

export interface RemoteComputerClientOptions {
  /** The joined servers and the switch of each, from the remote server manager. */
  servers: () => readonly RemoteComputerServer[];
  /** Turns the switch of a server off, for Stop. */
  disable: (serverId: string) => Effect.Effect<void, RemoteWorkflowError>;
  send: (serverId: string, path: string, body: RemoteComputerBody) => Effect.Effect<unknown, RemoteWorkflowError>;
  /** This computer's Computer Use entry while the driver runs with its grants, or null. */
  driver: () => McpServerConfig | null;
  computerName: () => string;
  /** A screenshot as JPEG at the same size, in base64, or null when it cannot be read. */
  toJpeg: (data: string, mimeType: string, quality: number) => string | null;
  now?: () => number;
}

interface Session {
  serverName: string;
  startedAt: number;
  lastCallAt: number;
  running: number;
  readonly calls: Set<AbortController>;
}

interface Connection {
  readonly key: string;
  readonly client: Client;
  readonly ready: Promise<void>;
  tools: Tool[] | null;
}

export class RemoteComputerClient {
  readonly #options: RemoteComputerClientOptions;
  readonly #now: () => number;
  /** The servers that were last told that this computer is available. */
  readonly #announced = new Set<string>();
  readonly #sessions = new Map<string, Session>();
  readonly #sessionListeners = new Set<(sessions: RemoteComputerSession[]) => void>();
  #connection: Connection | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #sessionCheck: ReturnType<typeof setInterval> | null = null;
  #disposed = false;

  constructor(options: RemoteComputerClientOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#heartbeat || this.#disposed) return;
    this.#heartbeat = setInterval(() => this.#announce(true), REMOTE_COMPUTER_STATE_INTERVAL_MS);
    this.#heartbeat.unref?.();
    this.reconcile();
  }

  /** The servers, the switches or the driver changed: tell each host what is true now. */
  readonly reconcile = (): void => {
    if (this.#disposed) return;
    this.#announce(false);
    // A server whose switch went off loses its session at once, and its running calls stop.
    const enabled = new Set(
      this.#options
        .servers()
        .filter((server) => server.enabled)
        .map((server) => server.serverId),
    );
    for (const serverId of [...this.#sessions.keys()]) if (!enabled.has(serverId)) this.#endSession(serverId);
    if (!this.#options.driver()) this.#closeConnection();
  };

  /** Told when a server starts or stops using this computer. */
  onSessionsChanged(listener: (sessions: RemoteComputerSession[]) => void): () => void {
    this.#sessionListeners.add(listener);
    return () => this.#sessionListeners.delete(listener);
  }

  #emitSessions(): void {
    const sessions = this.sessions();
    for (const listener of this.#sessionListeners) {
      try {
        listener(sessions);
      } catch (error) {
        logger.warn("A remote computer session listener failed.", toLogValue(error));
      }
    }
  }

  /** When the oldest session started, or null while no agent on a server uses this computer. */
  activeSince(): number | null {
    let earliest: number | null = null;
    for (const session of this.#sessions.values())
      if (earliest === null || session.startedAt < earliest) earliest = session.startedAt;
    return earliest;
  }

  sessions(): RemoteComputerSession[] {
    return [...this.#sessions].map(([serverId, session]) => ({
      serverId,
      serverName: session.serverName,
      startedAt: session.startedAt,
    }));
  }

  /** Stop: the switch of that server goes off, and its session ends now. */
  readonly stop = Effect.fn("RemoteComputerClient.stop")(function* (this: RemoteComputerClient, serverId: string) {
    this.#endSession(serverId);
    yield* this.#options.disable(serverId);
    this.reconcile();
  }).bind(this);

  readonly handleCall = (serverId: string, event: RemoteComputerCallEvent): void => {
    if (this.#disposed) return;
    void Effect.runPromise(
      this.#answer(serverId, event).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => logger.warn("A remote computer answer was not sent.", toLogValue(failure.cause))),
        ),
      ),
    );
  };

  dispose(): void {
    this.#disposed = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    if (this.#sessionCheck) clearInterval(this.#sessionCheck);
    this.#sessionCheck = null;
    for (const serverId of [...this.#sessions.keys()]) this.#endSession(serverId);
    // The hosts forget this computer when its state expires; a quitting app does not wait for them.
    for (const serverId of this.#announced)
      void Effect.runPromise(
        Effect.ignore(
          this.#options.send(serverId, REMOTE_COMPUTER_USE_ROUTES.state, {
            available: false,
            computerName: this.#options.computerName(),
          }),
        ),
      );
    this.#announced.clear();
    this.#closeConnection();
  }

  /** Whether `serverId` may use this computer now. */
  #allowed(serverId: string): RemoteComputerServer | null {
    if (!this.#options.driver()) return null;
    const server = this.#options.servers().find((candidate) => candidate.serverId === serverId);
    return server?.enabled && server.supported && server.connected ? server : null;
  }

  #announce(repeat: boolean): void {
    const computerName = this.#options.computerName();
    const driverReady = this.#options.driver() !== null;
    for (const server of this.#options.servers()) {
      if (!server.supported || !server.connected) {
        // A host that is not connected forgets this computer by itself.
        if (!server.connected) this.#announced.delete(server.serverId);
        continue;
      }
      const wanted = server.enabled && driverReady;
      const announced = this.#announced.has(server.serverId);
      if (!wanted && !announced) continue;
      if (wanted && announced && !repeat) continue;
      if (wanted) this.#announced.add(server.serverId);
      else this.#announced.delete(server.serverId);
      void Effect.runPromise(
        this.#options.send(server.serverId, REMOTE_COMPUTER_USE_ROUTES.state, { available: wanted, computerName }).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              // Sent again at the next change or heartbeat.
              if (wanted) this.#announced.delete(server.serverId);
              logger.warn("A server was not told whether this computer is available.", toLogValue(failure.cause));
            }),
          ),
        ),
      );
    }
  }

  readonly #answer = Effect.fn("RemoteComputerClient.answer")(function* (
    this: RemoteComputerClient,
    serverId: string,
    event: RemoteComputerCallEvent,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const server = this.#allowed(serverId);
    const reply = (ok: boolean, payload: string) =>
      this.#options
        .send(serverId, REMOTE_COMPUTER_USE_ROUTES.reply, { requestId: event.requestId, ok, payload })
        .pipe(Effect.asVoid);
    if (!server) return yield* reply(false, "This computer does not let the agents of this server use it now.");
    const controller = new AbortController();
    const session = this.#begin(serverId, server.serverName, controller);
    const outcome = yield* this.#run(event, controller.signal).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((failure) =>
        Effect.succeed({
          ok: false as const,
          value: failure.cause instanceof Error ? failure.cause.message : "The request failed on this computer.",
        }),
      ),
      Effect.ensuring(Effect.sync(() => this.#finish(session, controller))),
    );
    // Stop ends the session: a call that was running then gets no result.
    if (controller.signal.aborted) return yield* reply(false, "The user stopped agents from using this computer.");
    if (!outcome.ok) return yield* reply(false, outcome.value.slice(0, 2_000));
    yield* reply(true, outcome.value);
  });

  /** The JSON text of the answer, small enough for the reply route. */
  readonly #run = Effect.fn("RemoteComputerClient.run")(function* (
    this: RemoteComputerClient,
    event: RemoteComputerCallEvent,
    signal: AbortSignal,
  ): Effect.fn.Return<string, RemoteComputerClientError> {
    const connection = yield* this.#connect();
    const options = { signal, timeout: CALL_TIMEOUT_MS };
    if (event.operation === "list-tools") {
      const tools = yield* this.#tools(connection, signal);
      const result: ListToolsResult = { tools };
      return JSON.stringify(result);
    }
    if (BLOCKED_TOOLS.has(event.tool))
      return yield* new RemoteComputerClientError({
        cause: new Error(`The tool "${event.tool}" is not available to agents on another computer.`),
      });
    let input: unknown;
    try {
      input = JSON.parse(event.arguments);
    } catch {
      return yield* new RemoteComputerClientError({ cause: new Error("The tool arguments are not JSON.") });
    }
    if (!isDynamicRecord(input))
      return yield* new RemoteComputerClientError({ cause: new Error("The tool arguments are not an object.") });
    const tools = yield* this.#tools(connection, signal);
    const tool = tools.find((candidate) => candidate.name === event.tool);
    if (!tool)
      return yield* new RemoteComputerClientError({ cause: new Error(`This computer has no tool "${event.tool}".`) });
    const properties = isDynamicRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
    // A screenshot comes at a size the reply carries, unless the agent named a size.
    const smaller =
      "max_image_dimension" in properties &&
      (input.max_image_dimension === undefined || input.max_image_dimension === 0);
    const args: DynamicRecord = smaller ? { ...input, max_image_dimension: DEFAULT_IMAGE_DIMENSION } : { ...input };
    const raw = yield* clientCall(() =>
      connection.client.callTool({ name: event.tool, arguments: args }, undefined, options),
    ).pipe(Effect.tapError(() => Effect.sync(() => this.#dropIfClosed(connection))));
    const parsed = CallToolResultSchema.safeParse(raw);
    if (!parsed.success)
      return yield* new RemoteComputerClientError({
        cause: new Error("Computer Use sent a result that is not valid."),
      });
    const result = parsed.data;
    return yield* this.#fit(result);
  });

  /** The tool list without the blocked tools, read once for each connection. */
  #tools(connection: Connection, signal: AbortSignal): Effect.Effect<Tool[], RemoteComputerClientError> {
    if (connection.tools) return Effect.succeed(connection.tools);
    return clientCall(() => connection.client.listTools(undefined, { signal, timeout: CALL_TIMEOUT_MS })).pipe(
      Effect.map((result) => {
        const tools = result.tools.filter((tool) => !BLOCKED_TOOLS.has(tool.name));
        connection.tools = tools;
        return tools;
      }),
      Effect.tapError(() => Effect.sync(() => this.#dropIfClosed(connection))),
    );
  }

  /**
   * The answer as JSON, under the reply limit. A screenshot that is too large is sent again as JPEG at
   * the same size, so its coordinates stay true; a lower quality follows until it fits.
   */
  #fit(result: CallToolResult): Effect.Effect<string, RemoteComputerClientError> {
    return Effect.suspend(() => {
      let text = JSON.stringify(result);
      if (text.length <= REMOTE_COMPUTER_REPLY_MAX_LENGTH) return Effect.succeed(text);
      const images = result.content.filter(
        (item): item is Extract<CallToolResult["content"][number], { type: "image" }> => item.type === "image",
      );
      if (images.length === 0)
        return Effect.fail(
          new RemoteComputerClientError({ cause: new Error("The answer is too large to send to the server.") }),
        );
      const originals = images.map((image) => ({ data: image.data, mimeType: image.mimeType }));
      for (const quality of JPEG_QUALITIES) {
        images.forEach((image, index) => {
          const original = originals[index];
          if (!original) return;
          const jpeg = this.#options.toJpeg(original.data, original.mimeType, quality);
          if (jpeg) {
            image.data = jpeg;
            image.mimeType = "image/jpeg";
          }
        });
        text = JSON.stringify(result);
        if (text.length <= REMOTE_COMPUTER_REPLY_MAX_LENGTH) return Effect.succeed(text);
      }
      return Effect.fail(
        new RemoteComputerClientError({
          cause: new Error(
            "The screenshot is too large to send to the server. Ask again with a smaller max_image_dimension.",
          ),
        }),
      );
    });
  }

  #connect(): Effect.Effect<Connection, RemoteComputerClientError> {
    return Effect.suspend(() => {
      const config = this.#options.driver();
      if (!config)
        return Effect.fail(
          new RemoteComputerClientError({ cause: new Error("Computer Use is not ready on this computer.") }),
        );
      const key = JSON.stringify([config.command, config.args, config.env]);
      if (this.#connection?.key !== key) {
        this.#closeConnection();
        const client = new Client({ name: "openbot-remote-computer", version: "1" }, { capabilities: {} });
        const passthrough = Object.fromEntries(
          config.envPassthrough.flatMap((name) => {
            const value = process.env[name];
            return value === undefined ? [] : [[name, value]];
          }),
        );
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: {
            ...getDefaultEnvironment(),
            ...passthrough,
            ...Object.fromEntries(config.env.map((pair) => [pair.key, pair.value])),
          },
          stderr: "ignore",
        });
        const connection: Connection = { key, client, ready: client.connect(transport), tools: null };
        client.onclose = () => {
          if (this.#connection === connection) this.#connection = null;
        };
        this.#connection = connection;
      }
      const connection = this.#connection;
      if (!connection)
        return Effect.fail(
          new RemoteComputerClientError({ cause: new Error("Computer Use closed on this computer.") }),
        );
      return clientCall(() => connection.ready).pipe(
        Effect.as(connection),
        Effect.tapError(() => Effect.sync(() => this.#dropIfClosed(connection, true))),
      );
    });
  }

  #dropIfClosed(connection: Connection, always = false): void {
    if (this.#connection !== connection) return;
    if (!always && connection.client.transport) return;
    this.#closeConnection();
  }

  #closeConnection(): void {
    const connection = this.#connection;
    this.#connection = null;
    if (connection) void connection.client.close().catch(() => undefined);
  }

  #begin(serverId: string, serverName: string, controller: AbortController): Session {
    const now = this.#now();
    let session = this.#sessions.get(serverId);
    const started = !session;
    if (!session) {
      session = { serverName, startedAt: now, lastCallAt: now, running: 0, calls: new Set() };
      this.#sessions.set(serverId, session);
    }
    session.serverName = serverName;
    session.lastCallAt = now;
    session.running += 1;
    session.calls.add(controller);
    if (started) {
      this.#startSessionCheck();
      this.#emitSessions();
    }
    return session;
  }

  #finish(session: Session, controller: AbortController): void {
    session.calls.delete(controller);
    session.running = Math.max(0, session.running - 1);
    session.lastCallAt = this.#now();
  }

  #endSession(serverId: string): void {
    const session = this.#sessions.get(serverId);
    if (!session) return;
    this.#sessions.delete(serverId);
    for (const controller of session.calls) controller.abort();
    session.calls.clear();
    this.#emitSessions();
  }

  #startSessionCheck(): void {
    if (this.#sessionCheck) return;
    this.#sessionCheck = setInterval(() => {
      const cutoff = this.#now() - SESSION_IDLE_MS;
      for (const [serverId, session] of [...this.#sessions])
        if (session.running === 0 && session.lastCallAt < cutoff) this.#endSession(serverId);
      if (this.#sessions.size === 0 && this.#sessionCheck) {
        clearInterval(this.#sessionCheck);
        this.#sessionCheck = null;
      }
    }, SESSION_CHECK_MS);
    this.#sessionCheck.unref?.();
  }
}
