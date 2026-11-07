// Who an actor of Computer Use is, in words a person and an agent can read.
//
// The coordinator and the tap know an actor by its key, its agent id and its thread id. The refusal
// an agent reads and the label on each agent cursor need the agent's name and the thread's title,
// which only the agent service knows, so the main process passes a directory in.

import type { AvatarColor } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import {
  COMPUTER_USE_REMOTE_ACTOR_KEY,
  type ComputerUseActor,
  type ComputerUseRefused,
} from "./computer-use-coordinator";

/** What the agent service knows about one agent. */
export interface ComputerUseAgentEntry {
  name: string;
  color: AvatarColor | null;
  /** The public thread of the agent's own chat. */
  chatThreadId: string;
}

export interface ComputerUseActorDirectory {
  agent: (agentId: string) => ComputerUseAgentEntry | null;
  /** The title of a side thread of the agent, or `null` when it has none or is gone. */
  threadTitle: (agentId: string, threadId: string) => string | null;
}

/** An actor in words: the agent, the conversation, and the agent's colour when it has one. */
export interface ComputerUseActorLabel {
  agent: string;
  thread: string;
  color: AvatarColor | null;
}

export function computerUseActorLabel(
  directory: ComputerUseActorDirectory,
  actor: Pick<ComputerUseActor, "key" | "agentId" | "threadId">,
): ComputerUseActorLabel {
  if (actor.key === COMPUTER_USE_REMOTE_ACTOR_KEY)
    return {
      agent: sourceText("status.computerUse.anotherAgent"),
      thread: sourceText("status.computerUse.joinedServer"),
      color: null,
    };
  const entry = actor.agentId ? directory.agent(actor.agentId) : null;
  if (!entry || !actor.agentId)
    return {
      agent: sourceText("status.computerUse.anotherAgent"),
      thread: sourceText("status.computerUse.unnamedThread"),
      color: null,
    };
  const thread =
    actor.threadId === null || actor.threadId === entry.chatThreadId
      ? sourceText("status.computerUse.mainChat")
      : (directory.threadTitle(actor.agentId, actor.threadId) ?? sourceText("status.computerUse.unnamedThread"));
  return { agent: entry.name, thread, color: entry.color };
}

/**
 * The label of each actor, read again at most once in `ttlMs`. The cursor poll asks for every cursor
 * thirty times a second, and a side thread's title is a database read.
 */
export function cachedComputerUseActorLabels(
  directory: ComputerUseActorDirectory,
  ttlMs = 5_000,
  now: () => number = Date.now,
): (actor: ComputerUseActor) => ComputerUseActorLabel {
  const cache = new Map<string, { label: ComputerUseActorLabel; at: number }>();
  return (actor) => {
    const hit = cache.get(actor.key);
    if (hit && now() - hit.at < ttlMs) return hit.label;
    const label = computerUseActorLabel(directory, actor);
    cache.set(actor.key, { label, at: now() });
    return label;
  };
}

/**
 * The tool error for a refused request. It names the holder of the app, so the agent can tell the
 * user who is in the way, and says what to do instead.
 */
export function computerUseRefusalText(
  directory: ComputerUseActorDirectory,
  appName: (pid: number) => Effect.Effect<string | null>,
  refused: ComputerUseRefused,
): Effect.Effect<string> {
  if (refused.reason === "busy") return Effect.succeed(sourceText("error.computerUse.desktopBusy"));
  const holder = computerUseActorLabel(directory, {
    key: refused.holderKey ?? "",
    agentId: refused.holderAgentId,
    threadId: refused.holderThreadId,
  });
  const app = refused.pid === null ? Effect.succeed(null) : appName(refused.pid);
  return app.pipe(
    Effect.map((name) =>
      sourceText("error.computerUse.appInUse", {
        app: name ?? sourceText("status.computerUse.thisApp"),
        agent: holder.agent,
        thread: holder.thread,
      }),
    ),
  );
}
