// The Agent Computer account of this server: the API key that the built-in `computer_*` tools and coding
// jobs use to start cloud computers (computer.mcpbox.dev). The key is encrypted at rest by the operating
// system, kept decrypted in memory only, and registered for redaction before anything can log it.

import { readFile, rm } from "node:fs/promises";
import type { AgentComputerMachineList, AgentComputerStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { AgentComputerApi, type AgentComputerFailed } from "../backend/agent-computer/agent-computer-api";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";

export class AgentComputerServiceFailed extends Schema.TaggedError<AgentComputerServiceFailed>()(
  "AgentComputerServiceFailed",
  { cause: Schema.Defect() },
) {}

const recordSchema = Schema.Struct({ apiKey: Schema.String, connectedAt: Schema.Number });
type AgentComputerRecord = typeof recordSchema.Type;
const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });
/** One record is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;
/** No spaces, and long enough to be a key: `cmk_` plus 43 characters, or a longer access token. */
const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{20,4096}$/u;
/** The API stores the first 12 characters to tell keys apart; the same prefix is safe to show. */
const HINT_LENGTH = 12;

export interface AgentComputerServiceOptions {
  path: string;
  cipher: SecretCipher;
  /** The API root, for a test against a local server. */
  baseUrl?: string | undefined;
}

export class AgentComputerService {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  readonly #queue = Semaphore.makeUnsafe(1);
  readonly api: AgentComputerApi;
  #record: AgentComputerRecord | null = null;
  #error: string | null = null;

  constructor(options: AgentComputerServiceOptions) {
    this.#path = options.path;
    this.#cipher = options.cipher;
    this.api = new AgentComputerApi({ key: () => this.key(), baseUrl: options.baseUrl });
  }

  /** The saved key, or null. Read at each call, so a connect or a disconnect applies at once. */
  key(): string | null {
    return this.#record?.apiKey ?? null;
  }

  status(): AgentComputerStatus {
    return {
      connected: this.#record !== null,
      keyHint: this.#record ? this.#record.apiKey.slice(0, HINT_LENGTH) : null,
      error: this.#error,
    };
  }

  /** Reads the saved key. An unreadable file leaves the server not connected and says so. */
  load() {
    return Effect.gen({ self: this }, function* () {
      const result = yield* Effect.result(this.#read());
      if (Result.isFailure(result)) {
        this.#record = null;
        this.#error = sourceText("error.connector.agentComputerFileUnreadable");
        return;
      }
      this.#record = result.success;
      if (this.#record) registerSecretValue(this.#record.apiKey);
    }).pipe(this.#serialize.bind(this), Effect.withSpan("AgentComputerService.load"));
  }

  /**
   * Tests `apiKey` with a list of the machines, and saves it when the API accepts it. A key that the
   * API refuses is not saved: the status keeps the previous key and carries the API's message.
   */
  connect(input: string) {
    return Effect.gen({ self: this }, function* () {
      const apiKey = input.trim();
      if (!KEY_PATTERN.test(apiKey)) {
        this.#error = sourceText("error.connector.agentComputerKeyInvalid");
        return this.status();
      }
      registerSecretValue(apiKey);
      const tested = yield* Effect.result(this.api.list(apiKey));
      if (Result.isFailure(tested)) {
        this.#error = failureText(tested.failure);
        return this.status();
      }
      const record = { apiKey, connectedAt: Date.now() };
      const encrypted = yield* Effect.try({
        try: () => this.#cipher.encrypt(JSON.stringify(record)).toString("base64"),
        catch: (cause) => new AgentComputerServiceFailed({ cause }),
      });
      yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
        Effect.mapError(({ cause }) => new AgentComputerServiceFailed({ cause })),
      );
      this.#record = record;
      this.#error = null;
      return this.status();
    }).pipe(this.#serialize.bind(this), Effect.withSpan("AgentComputerService.connect"));
  }

  /** Lists the machines with the saved key, and keeps the outcome in the status. */
  test() {
    return Effect.gen({ self: this }, function* () {
      if (!this.#record) return this.status();
      const tested = yield* Effect.result(this.api.list());
      this.#error = Result.isFailure(tested) ? failureText(tested.failure) : null;
      return this.status();
    }).pipe(this.#serialize.bind(this), Effect.withSpan("AgentComputerService.test"));
  }

  /** Removes the saved key after earlier credential changes finish. Running machines keep running. */
  disconnect() {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.tryPromise({
        try: () => rm(this.#path, { force: true }),
        catch: (cause) => new AgentComputerServiceFailed({ cause }),
      });
      this.#record = null;
      this.#error = null;
      return this.status();
    }).pipe(this.#serialize.bind(this), Effect.withSpan("AgentComputerService.disconnect"));
  }

  /** The registry of the account. It wakes no machine. */
  machines() {
    return Effect.gen({ self: this }, function* () {
      const machines = yield* this.api
        .list()
        .pipe(Effect.mapError((failure) => new AgentComputerServiceFailed({ cause: new Error(failureText(failure)) })));
      const list: AgentComputerMachineList = {
        machines: machines.map((machine) => ({
          id: machine.id,
          context: machine.context,
          status: machine.status,
          deadlineAt: machine.deadline_at,
          liveViewUrl: machine.live_view_url,
          updatedAt: machine.updated_at,
        })),
      };
      return list;
    }).pipe(Effect.withSpan("AgentComputerService.machines"));
  }

  #serialize<A>(change: Effect.Effect<A, AgentComputerServiceFailed>): Effect.Effect<A, AgentComputerServiceFailed> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("AgentComputerService.read")(function* (this: AgentComputerService) {
    const source = yield* Effect.tryPromise({
      try: () => readFile(this.#path, "utf8"),
      catch: (cause) => new AgentComputerServiceFailed({ cause }),
    }).pipe(
      Effect.catch((failure) =>
        failure.cause instanceof Error && "code" in failure.cause && failure.cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(failure),
      ),
    );
    if (source === null) return null;
    return yield* Effect.try({
      try: () => {
        if (source.length > MAX_ENVELOPE_BYTES) throw new Error("too large");
        const envelope = Schema.decodeUnknownSync(envelopeSchema)(JSON.parse(source));
        return Schema.decodeUnknownSync(recordSchema)(
          JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
        );
      },
      catch: (cause) => new AgentComputerServiceFailed({ cause }),
    });
  });
}

function failureText(failure: AgentComputerFailed): string {
  return failure.code === "UNAUTHORIZED" ? `${failure.code}: ${failure.message}` : failure.message;
}
