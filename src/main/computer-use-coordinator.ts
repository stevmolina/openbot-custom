// Turns for Computer Use across every agent and every thread of this computer.
//
// There is one screen, one keyboard and one pointer, and every agent and thread that has Computer
// Use reaches them through the same driver daemon. The daemon acts in the background and takes no
// turns itself, so two conversations that type at the same time can each send keys into the other's
// window. OpenBot owns the address each provider's driver proxy connects to (`CuaDriverActionTap`),
// and each conversation gets an address of its own, so the tap knows which actor sent a request.
// This module decides when that request may reach the daemon.
//
// Two rules, borrowed from agent-desktop's design:
//
// - The action lease. An action that sends input runs alone: it takes the one lease, the daemon
//   acts, and the lease goes to the next waiting action when the answer comes back. Waiters are
//   served first in, first out, so no actor waits behind a busy one forever. A read (a screenshot,
//   an accessibility tree, a window list) changes nothing and takes no lease.
// - The app claim. The first actor that sends input to an application holds a claim on it. Another
//   actor that sends input there waits a bounded time for the claim to end, then gets a tool error
//   that names the holder. An action that takes keyboard focus is refused at once instead: a key
//   press that waits might land after the holder typed half a word. A claim ends with the holder's
//   turn, or after `claimIdleMs` with no action from the holder.
//
// The rules are cooperative, not a security boundary: every agent runs as the same user and can reach
// the daemon's socket. They keep honest agents out of each other's way.

import { createHash } from "node:crypto";
import { createOpenBotLogger, type Logger } from "@openbot/logging";
import { Deferred, Effect, Exit, Option, Schema } from "effect";

const logger = createOpenBotLogger("computer-use-coordinator");

/** The actor of a request that came in on the shared address, which names no conversation. */
export const COMPUTER_USE_SHARED_ACTOR_KEY = "shared";
/** The actor of every call that an agent on a joined server makes on this computer. */
export const COMPUTER_USE_REMOTE_ACTOR_KEY = "remote";

/** Who sent a Computer Use request. */
export interface ComputerUseActor {
  /** Stable for one conversation: a digest of its agent and thread, or one of the keys above. */
  key: string;
  /** The OpenBot agent, or `null` for the shared and the remote actor. */
  agentId: string | null;
  /** The public thread: the agent's own chat or one of its side threads. */
  threadId: string | null;
}

/** The remote actor: every agent on a joined server that uses this computer. */
export const COMPUTER_USE_REMOTE_ACTOR: ComputerUseActor = {
  key: COMPUTER_USE_REMOTE_ACTOR_KEY,
  agentId: null,
  threadId: null,
};

/**
 * The actor of one conversation. The key is a digest, so it is the same in every run, holds no id
 * in a socket path, and is short enough for one: a socket path holds about a hundred bytes.
 */
export function computerUseActor(agentId: string, threadId: string | null): ComputerUseActor {
  const key = createHash("sha256")
    .update(`${agentId}\0${threadId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return { key, agentId, threadId };
}

/**
 * What a tool does to the desktop.
 *
 * - `read` takes no lease: it changes nothing the user or another agent could feel.
 * - `input` takes the lease and, when it names an application, a claim on it.
 * - `focus` is input that can take keyboard focus. It is refused, not queued, on an application
 *   another actor holds.
 */
export type ComputerUseActionKind = "read" | "input" | "focus";

/**
 * Tools that read the desktop, or change only the driver's own session, cursor or settings.
 *
 * Every other tool counts as input, a tool a later driver adds included: a new tool that waits for a
 * lease it did not need costs a few milliseconds, and one that skips a lease it needed can type into
 * another agent's window.
 */
const NO_INPUT_TOOLS: ReadonlySet<string> = new Set([
  "list_apps",
  "list_windows",
  "get_window_state",
  "verify_state",
  "clipboard_read",
  "get_screen_size",
  "get_desktop_state",
  "get_cursor_position",
  "get_agent_cursor_state",
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_theme",
  "check_permissions",
  "health_report",
  "get_config",
  "get_accessibility_tree",
  "zoom",
  "get_browser_state",
  "get_recording_state",
  "start_session",
  "escalate_session",
  "get_session",
  "list_sessions",
  "get_session_state",
  "end_session",
  "check_for_update",
  "parse_visual_regions",
]);

/** Input tools that send keys or bring a window to the front, so they move keyboard focus. */
const FOCUS_TOOLS: ReadonlySet<string> = new Set(["type_text", "press_key", "hotkey", "set_value", "bring_to_front"]);

export function computerUseActionKind(tool: string): ComputerUseActionKind {
  if (NO_INPUT_TOOLS.has(tool)) return "read";
  return FOCUS_TOOLS.has(tool) ? "focus" : "input";
}

/** One tool call, as far as the turns are concerned: its tool and the application it names. */
export interface ComputerUseRequest {
  tool: string;
  /** The process the request names, or `null` when it names none (a desktop point, a hotkey). */
  pid: number | null;
}

/** Why a request did not reach the daemon. The tap turns it into a tool error the agent reads. */
export class ComputerUseRefused extends Schema.TaggedError<ComputerUseRefused>()("ComputerUseRefused", {
  reason: Schema.Literals(["app-in-use", "busy"]),
  pid: Schema.NullOr(Schema.Number),
  holderKey: Schema.NullOr(Schema.String),
  holderAgentId: Schema.NullOr(Schema.String),
  holderThreadId: Schema.NullOr(Schema.String),
}) {}

/** A request that may run. `release` ends its lease; it is safe to call more than once. */
export interface ComputerUseAdmission {
  release(): void;
}

const NO_ADMISSION: ComputerUseAdmission = { release: () => undefined };

/** What happened, for the log and for the end-to-end report. Never the request's arguments. */
export type ComputerUseCoordinatorEvent =
  | { type: "lease-granted"; actor: string; tool: string; waitedMs: number }
  | { type: "lease-released"; actor: string; heldMs: number; forced: boolean }
  | { type: "claim-taken"; actor: string; pid: number }
  | { type: "claim-ended"; actor: string; pid: number; why: "turn-ended" | "idle" }
  | { type: "refused"; actor: string; tool: string; reason: "app-in-use" | "busy"; holder: string | null };

export interface ComputerUseCoordinatorOptions {
  now?: () => number;
  /** The longest an action waits in the lease queue. */
  leaseWaitMs?: number;
  /**
   * The longest one action holds the lease. An action the daemon does not answer would otherwise
   * stop every agent; the daemon may still finish it after the lease moves on.
   */
  leaseHoldMs?: number;
  /** The longest an input action waits for another actor's claim on its application to end. */
  claimWaitMs?: number;
  /** A claim with no action from its holder for this long ends by itself. */
  claimIdleMs?: number;
  logger?: Logger;
}

/**
 * Long enough for the slowest driver action seen in practice (a launch, a menu walk), and short
 * enough that a provider's own tool timeout, a minute or more, does not fire first.
 */
const DEFAULT_LEASE_WAIT_MS = 30_000;
const DEFAULT_LEASE_HOLD_MS = 30_000;
const DEFAULT_CLAIM_WAIT_MS = 15_000;
/** A minute: longer than a model's think time between two steps, short enough for a stalled turn. */
const DEFAULT_CLAIM_IDLE_MS = 60_000;

interface Lease {
  actor: ComputerUseActor;
  tool: string;
  token: symbol;
  since: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Waiter {
  actor: ComputerUseActor;
  tool: string;
  token: symbol;
  ready: Deferred.Deferred<void>;
}

interface Claim {
  actor: ComputerUseActor;
  lastAt: number;
}

export class ComputerUseCoordinator {
  readonly #now: () => number;
  readonly #leaseWaitMs: number;
  readonly #leaseHoldMs: number;
  readonly #claimWaitMs: number;
  readonly #claimIdleMs: number;
  readonly #logger: Logger;
  #lease: Lease | null = null;
  readonly #queue: Waiter[] = [];
  readonly #claims = new Map<number, Claim>();
  /** Done and replaced each time a claim ends, so a waiter wakes at once rather than at its deadline. */
  #claimsChanged = Deferred.makeUnsafe<void>();
  readonly #listeners = new Set<(event: ComputerUseCoordinatorEvent) => void>();

  constructor(options: ComputerUseCoordinatorOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#leaseWaitMs = options.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS;
    this.#leaseHoldMs = options.leaseHoldMs ?? DEFAULT_LEASE_HOLD_MS;
    this.#claimWaitMs = options.claimWaitMs ?? DEFAULT_CLAIM_WAIT_MS;
    this.#claimIdleMs = options.claimIdleMs ?? DEFAULT_CLAIM_IDLE_MS;
    this.#logger = options.logger ?? logger;
  }

  onEvent(listener: (event: ComputerUseCoordinatorEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Waits until the request may reach the daemon, or fails with the reason it may not.
   *
   * Interrupting the wait (the agent closed its connection) leaves the queue and gives back a lease
   * that was handed over meanwhile.
   */
  admit = Effect.fn("ComputerUseCoordinator.admit")(function* (
    this: ComputerUseCoordinator,
    actor: ComputerUseActor,
    request: ComputerUseRequest,
  ): Effect.fn.Return<ComputerUseAdmission, ComputerUseRefused> {
    const kind = computerUseActionKind(request.tool);
    if (kind === "read") return NO_ADMISSION;
    const deadline = this.#now() + this.#claimWaitMs;
    while (true) {
      const holder = this.#claimHolder(request.pid, actor);
      if (holder) {
        if (kind === "focus" || this.#now() >= deadline)
          return yield* this.#refuse(actor, request, "app-in-use", holder.actor);
        yield* this.#waitForClaims(deadline - this.#now());
        continue;
      }
      const token = yield* this.#acquireLease(actor, request);
      // Another actor may have claimed the application while this one waited in the queue.
      if (this.#claimHolder(request.pid, actor)) {
        this.#releaseLease(token, false);
        continue;
      }
      if (request.pid !== null) this.#claim(request.pid, actor);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          if (request.pid !== null) this.#touch(request.pid, actor);
          this.#releaseLease(token, false);
        },
      };
    }
  });

  /**
   * Ends every claim the turn's thread holds. A stopped or failed turn ends here too, and so does
   * the last turn of an agent that is removed.
   */
  turnEnded(agentId: string, threadId: string | null): void {
    let ended = false;
    for (const [pid, claim] of this.#claims) {
      if (claim.actor.agentId !== agentId) continue;
      if (threadId !== null && claim.actor.threadId !== null && claim.actor.threadId !== threadId) continue;
      this.#claims.delete(pid);
      this.#emit({ type: "claim-ended", actor: claim.actor.key, pid, why: "turn-ended" });
      ended = true;
    }
    if (ended) this.#signalClaims();
  }

  /** The application a live claim names, with its holder. For the report and the log. */
  claims(): Array<{ pid: number; actor: ComputerUseActor; idleMs: number }> {
    this.#expireIdleClaims();
    const now = this.#now();
    return [...this.#claims].map(([pid, claim]) => ({ pid, actor: claim.actor, idleMs: now - claim.lastAt }));
  }

  /** The actor holding the lease, or `null`. */
  leaseHolder(): ComputerUseActor | null {
    return this.#lease?.actor ?? null;
  }

  #claimHolder(pid: number | null, actor: ComputerUseActor): Claim | null {
    if (pid === null) return null;
    this.#expireIdleClaims();
    const claim = this.#claims.get(pid);
    return claim && claim.actor.key !== actor.key ? claim : null;
  }

  #claim(pid: number, actor: ComputerUseActor): void {
    const claim = this.#claims.get(pid);
    if (claim?.actor.key === actor.key) {
      claim.lastAt = this.#now();
      return;
    }
    this.#claims.set(pid, { actor, lastAt: this.#now() });
    this.#emit({ type: "claim-taken", actor: actor.key, pid });
  }

  /** The end of an action counts as activity too, so a long action does not let its claim lapse. */
  #touch(pid: number, actor: ComputerUseActor): void {
    const claim = this.#claims.get(pid);
    if (claim?.actor.key === actor.key) claim.lastAt = this.#now();
  }

  #expireIdleClaims(): void {
    const now = this.#now();
    let ended = false;
    for (const [pid, claim] of this.#claims) {
      if (now - claim.lastAt < this.#claimIdleMs) continue;
      this.#claims.delete(pid);
      this.#emit({ type: "claim-ended", actor: claim.actor.key, pid, why: "idle" });
      ended = true;
    }
    if (ended) this.#signalClaims();
  }

  #signalClaims(): void {
    const changed = this.#claimsChanged;
    this.#claimsChanged = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(changed, Exit.void);
  }

  /** Waits for a claim to end, at most `ms`. An idle claim ends by the clock, so the wait is capped by it too. */
  #waitForClaims(ms: number): Effect.Effect<void> {
    const changed = this.#claimsChanged;
    return Deferred.await(changed).pipe(Effect.timeoutOption(Math.max(1, Math.min(ms, 1_000))), Effect.asVoid);
  }

  #acquireLease(actor: ComputerUseActor, request: ComputerUseRequest): Effect.Effect<symbol, ComputerUseRefused> {
    return Effect.suspend(() => {
      const token = Symbol(actor.key);
      const asked = this.#now();
      if (!this.#lease && this.#queue.length === 0) {
        this.#grant(actor, request.tool, token, asked);
        return Effect.succeed(token);
      }
      const ready = Deferred.makeUnsafe<void>();
      const waiter: Waiter = { actor, tool: request.tool, token, ready };
      this.#queue.push(waiter);
      // Whether the lease came to this waiter, which the releaser decides before it wakes it.
      const holds = () => this.#lease?.token === token;
      const leave = Effect.sync(() => {
        const index = this.#queue.indexOf(waiter);
        if (index >= 0) this.#queue.splice(index, 1);
        if (holds()) this.#releaseLease(token, false);
      });
      return Deferred.await(ready).pipe(
        Effect.timeoutOption(this.#leaseWaitMs),
        Effect.flatMap((granted) => {
          if (Option.isSome(granted) || holds()) return Effect.succeed(token);
          return Effect.andThen(leave, this.#refuse(actor, request, "busy", this.#lease?.actor ?? null));
        }),
        Effect.onInterrupt(() => leave),
      );
    });
  }

  #grant(actor: ComputerUseActor, tool: string, token: symbol, asked: number): void {
    const now = this.#now();
    const timer = setTimeout(() => this.#releaseLease(token, true), this.#leaseHoldMs);
    timer.unref?.();
    this.#lease = { actor, tool, token, since: now, timer };
    this.#emit({ type: "lease-granted", actor: actor.key, tool, waitedMs: now - asked });
  }

  #releaseLease(token: symbol, forced: boolean): void {
    const lease = this.#lease;
    if (lease?.token !== token) return;
    if (lease.timer) clearTimeout(lease.timer);
    this.#lease = null;
    this.#emit({ type: "lease-released", actor: lease.actor.key, heldMs: this.#now() - lease.since, forced });
    if (forced) this.#logger.info("A Computer Use action held the lease too long", { tool: lease.tool });
    const next = this.#queue.shift();
    if (!next) return;
    this.#grant(next.actor, next.tool, next.token, this.#now());
    Deferred.doneUnsafe(next.ready, Exit.void);
  }

  #refuse(
    actor: ComputerUseActor,
    request: ComputerUseRequest,
    reason: "app-in-use" | "busy",
    holder: ComputerUseActor | null,
  ): Effect.Effect<never, ComputerUseRefused> {
    this.#emit({ type: "refused", actor: actor.key, tool: request.tool, reason, holder: holder?.key ?? null });
    return Effect.fail(
      new ComputerUseRefused({
        reason,
        pid: request.pid,
        holderKey: holder?.key ?? null,
        holderAgentId: holder?.agentId ?? null,
        holderThreadId: holder?.threadId ?? null,
      }),
    );
  }

  #emit(event: ComputerUseCoordinatorEvent): void {
    this.#logger.debug("Computer Use turn", { event: event.type, actor: event.actor });
    for (const listener of this.#listeners) listener(event);
  }
}
