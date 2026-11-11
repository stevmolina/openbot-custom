import type { AgentEvent } from "@openbot/contracts/ipc";
import type { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { serversPort } from "./servers-port";

/** The events that change what an agent of a server does now: a turn, a queue, a question or an approval. */
const ACTIVITY_EVENTS = new Set<AgentEvent["type"]>([
  "runtime-snapshot",
  "turn-started",
  "turn-completed",
  "conversation",
  "queue-changed",
  "prompt",
  "agent-input-resolved",
  "approval",
  "browser-takeover-requested",
  "browser-takeover-resolved",
]);

/** What the agents of one server do now: their turns, queues, waits and failed turns. */
export type MachineActivity = NonNullable<ReturnType<DynamicIslandCoordinator["serverState"]>>;

/**
 * What the agents of each server do now, for the "All machines" view.
 *
 * The Dynamic Island coordinator already follows the turn events of every server, the ones that the
 * user does not look at too, so the view reads it rather than keep a second copy. The coordinator is
 * not reactive: a change of activity bumps a version after the coordinator took the event, and a read
 * of `activity` follows that version.
 *
 * A joined server sends its runtime snapshot on its event stream, so `refresh` asks main to send it
 * again; the coordinator takes it like any other event.
 */
export function createMachineActivity(options: { coordinator: DynamicIslandCoordinator; enabled: () => boolean }) {
  const [version, setVersion] = createSignal(0);
  let bumpScheduled = false;
  const bump = () => {
    if (bumpScheduled) return;
    bumpScheduled = true;
    // After the coordinator's own listener took the event, whatever the order of the listeners.
    queueMicrotask(() => {
      bumpScheduled = false;
      setVersion((current) => current + 1);
    });
  };
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  onSettled(() =>
    serversPort().agent.onScopedEvent(({ event }) => {
      if (!disposed && options.enabled() && ACTIVITY_EVENTS.has(event.type)) bump();
    }),
  );

  return {
    /** What the agents of a server do now, or null for a server that sent nothing yet. */
    activity(serverId: string): MachineActivity | null {
      version();
      return options.coordinator.serverState(serverId);
    },
    /** Asks a joined server for its runtime snapshot again. This computer's server sends its events live. */
    refresh(serverId: string): void {
      void serversPort()
        .agent.getRuntimeSnapshot(serverId)
        .catch(() => null)
        .then(() => bump());
    },
  };
}
