import type { ClientAgentSummary, ConversationReadState, ServerSummary } from "@openbot/contracts/ipc";
import type { Machine, MachineAgents, MachineState } from "@openbot/ui/features/servers/MachinesPage";
import { createEffect, createMemo, createStore, onCleanup, onSettled } from "solid-js";
import { serversPort } from "./servers-port";

/** What the Machines page read from one server. */
interface MachineEntry {
  status: "loading" | "failed" | "ready";
  agents: readonly ClientAgentSummary[];
  reads: Record<string, ConversationReadState>;
}

/** A change of the agents of a server reads its list again after this wait, so a burst reads once. */
const RELOAD_DELAY_MS = 400;

/** A joined server must be online to answer. The server of this computer always answers. */
function serverReachable(server: ServerSummary): boolean {
  return server.kind === "local" || server.state === "online";
}

function machineState(server: ServerSummary): MachineState {
  if (server.hostedSleep) return "sleeping";
  return server.kind === "local" ? "online" : server.state;
}

/**
 * The agents of every server, for the Machines page. Main keeps one connection to each joined server,
 * so the page reads each one without a switch. A server is read when it comes online and again when
 * its agents change; one that does not answer keeps its state, and the other servers still show.
 */
export function createMachinesStore(options: { servers: () => readonly ServerSummary[] }) {
  const [entries, setEntries] = createStore<Record<string, MachineEntry>>({});
  /** Bumped for each read of a server, so an answer of an earlier read is dropped. */
  const generations = new Map<string, number>();
  const reloads = new Map<string, ReturnType<typeof setTimeout>>();
  onCleanup(() => {
    for (const timer of reloads.values()) clearTimeout(timer);
  });

  async function load(serverId: string): Promise<void> {
    const generation = (generations.get(serverId) ?? 0) + 1;
    generations.set(serverId, generation);
    setEntries((draft) => {
      const previous = draft[serverId];
      // A read again keeps the agents on screen; only the first read shows the loading line.
      draft[serverId] = previous?.status === "ready" ? previous : { status: "loading", agents: [], reads: {} };
    });
    const port = serversPort().agent;
    try {
      const [agents, reads] = await Promise.all([
        port.listAgents(serverId),
        // The unread counts are extra: a server that cannot give them still shows its agents.
        port.listConversationReads(serverId).catch(() => ({})),
      ]);
      if (generations.get(serverId) !== generation) return;
      setEntries((draft) => {
        draft[serverId] = { status: "ready", agents, reads };
      });
    } catch {
      if (generations.get(serverId) !== generation) return;
      setEntries((draft) => {
        draft[serverId] = { status: "failed", agents: [], reads: {} };
      });
    }
  }

  function scheduleReload(serverId: string): void {
    const pending = reloads.get(serverId);
    if (pending) clearTimeout(pending);
    reloads.set(
      serverId,
      setTimeout(() => {
        reloads.delete(serverId);
        void load(serverId);
      }, RELOAD_DELAY_MS),
    );
  }

  onSettled(() =>
    serversPort().agent.onScopedEvent(({ serverId, event }) => {
      if (event.type === "agents-changed") {
        setEntries((draft) => {
          const entry = draft[serverId];
          if (entry) {
            entry.status = "ready";
            entry.agents = event.agents;
          }
        });
        return;
      }
      // A new message moves the agent up and can change its unread count.
      if (event.type === "conversation" && entries[serverId]) scheduleReload(serverId);
    }),
  );

  // Each server that is reachable is read once; one that comes online again is read again.
  const reachableIds = createMemo(() =>
    options
      .servers()
      .filter(serverReachable)
      .map((server) => server.id)
      .join("\n"),
  );
  createEffect(reachableIds, (ids, previous) => {
    const before = new Set(previous ? previous.split("\n") : []);
    for (const serverId of ids ? ids.split("\n") : []) {
      if (!before.has(serverId)) void load(serverId);
    }
  });

  function machineAgents(server: ServerSummary): MachineAgents {
    const entry = entries[server.id];
    if (!entry || entry.status === "loading") return { status: "loading" };
    if (entry.status === "failed") return { status: "failed" };
    return {
      status: "ready",
      agents: entry.agents
        .filter((agent) => !agent.hiddenAt)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          title: agent.title,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarColor: agent.avatarColor ?? null,
          avatarUrl: agent.avatarUrl,
          updatedAt: agent.updatedAt,
          unread: entry.reads[agent.id]?.unreadCount ?? 0,
        })),
    };
  }

  const machines = createMemo((): Machine[] =>
    options.servers().map((server) => ({
      id: server.id,
      name: server.name,
      logoUrl: server.logoUrl,
      state: machineState(server),
      current: server.active,
      thisComputer: server.kind === "local" || server.thisComputer === true,
      agents: machineAgents(server),
    })),
  );

  return {
    machines,
    /** Reads the agents of a server again. */
    reload: (serverId: string) => void load(serverId),
  };
}
