import type { ClientAgentSummary, ConversationReadState, ServerSummary } from "@openbot/contracts/ipc";
import type { Machine, MachineAgents, MachineState } from "@openbot/ui/features/servers/MachinesPage";
import { createEffect, createMemo, createStore, onCleanup, onSettled } from "solid-js";
import { serversPort } from "./servers-port";

/** What the Machines page read from one server. */
interface MachineEntry {
  status: "loading" | "failed" | "ready";
  agents: readonly ClientAgentSummary[];
  reads: Record<string, ConversationReadState>;
  /**
   * The agents that a user hid on this server. A joined server tells them apart only through
   * `agent-hidden-v1`; `hiddenAt` on the agent is set on this computer's server alone.
   */
  hiddenIds: readonly string[];
}

/** Whether the store shows an agent: one that nobody hid, on this computer or on its joined server. */
function agentShown(entry: MachineEntry, agent: ClientAgentSummary): boolean {
  return !agent.hiddenAt && !entry.hiddenIds.includes(agent.id);
}

/**
 * A new message reads the list of its server again after this wait. The wait does not restart, so a
 * busy server is read at most once in this time and its list does not stay old while it works.
 */
const RELOAD_DELAY_MS = 2000;

/** A joined server must be online to answer. The server of this computer always answers. */
function serverReachable(server: ServerSummary): boolean {
  return server.kind === "local" || server.state === "online";
}

function machineState(server: ServerSummary): MachineState {
  if (server.hostedSleep) return "sleeping";
  return server.kind === "local" ? "online" : server.state;
}

/**
 * The agents of every server, for the Machines page and the "All machines" view of the sidebar. Main
 * keeps one connection to each joined server, so the store reads each one without a switch. A server
 * is read when it comes online and again when its agents change; one that does not answer keeps its
 * state, and the other servers still show. While `enabled` is false the store reads nothing; it reads
 * every server again when it turns on.
 */
export function createMachinesStore(options: {
  servers: () => readonly ServerSummary[];
  enabled?: (() => boolean) | undefined;
}) {
  const enabled = () => options.enabled?.() !== false;
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
      draft[serverId] =
        previous?.status === "ready" ? previous : { status: "loading", agents: [], reads: {}, hiddenIds: [] };
    });
    const port = serversPort().agent;
    try {
      const [agents, reads, hidden] = await Promise.all([
        port.listAgents(serverId),
        // The unread counts are extra: a server that cannot give them still shows its agents.
        port.listConversationReads(serverId).catch(() => ({})),
        // An older host has no hidden agents to give.
        port.listHiddenAgents(serverId).catch(() => ({ agents: [] })),
      ]);
      if (generations.get(serverId) !== generation) return;
      const hiddenIds = hidden.agents.map((agent) => agent.agentId);
      setEntries((draft) => {
        draft[serverId] = { status: "ready", agents, reads, hiddenIds };
      });
    } catch {
      if (generations.get(serverId) !== generation) return;
      setEntries((draft) => {
        draft[serverId] = { status: "failed", agents: [], reads: {}, hiddenIds: [] };
      });
    }
  }

  function scheduleReload(serverId: string): void {
    if (reloads.has(serverId)) return;
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
        // The event is newer than a read that is still on its way, so that read is dropped.
        generations.set(serverId, (generations.get(serverId) ?? 0) + 1);
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
      if (event.type === "conversation" && enabled() && entries[serverId]) scheduleReload(serverId);
    }),
  );

  // Each server that is reachable is read once; one that comes online again is read again.
  const reachableIds = createMemo(() =>
    enabled()
      ? options
          .servers()
          .filter(serverReachable)
          .map((server) => server.id)
          .join("\n")
      : "",
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
        .filter((agent) => agentShown(entry, agent))
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
          preview: agent.preview,
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

  /**
   * The read servers that the app still lists, but `skipServerId`. A server the user left keeps its
   * entry, and its old unread counts must not count.
   */
  function listedEntries(skipServerId: string | null): [string, MachineEntry][] {
    const listed = new Set(options.servers().map((server) => server.id));
    return Object.entries(entries).filter(
      ([serverId, entry]) => serverId !== skipServerId && listed.has(serverId) && entry.status === "ready",
    );
  }

  /**
   * Marks each unread agent chat of the servers read through its newest message, then reads those
   * servers again. The open server is left out: its own read state marks it, so its rows change at once.
   */
  async function markAllRead(skipServerId: string | null): Promise<void> {
    const port = serversPort().agent;
    const marked = listedEntries(skipServerId).flatMap(([serverId, entry]) =>
      entry.agents
        .filter((agent) => agentShown(entry, agent) && (entry.reads[agent.id]?.unreadCount ?? 0) > 0)
        .map(async (agent) => {
          const page = await port.readConversationPage(
            { agentId: agent.id, anchor: { type: "latest" }, limit: 1 },
            serverId,
          );
          const latestMessageId = page.messages.at(-1)?.id;
          if (latestMessageId) {
            await port.markConversationRead({ agentId: agent.id, throughMessageId: latestMessageId }, serverId);
          }
          return serverId;
        }),
    );
    const results = await Promise.allSettled(marked);
    const serverIds = new Set(results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
    for (const serverId of serverIds) void load(serverId);
  }

  /** Whether an agent of a server other than `skipServerId` has a message that the user did not read. */
  function hasUnread(skipServerId: string | null): boolean {
    return listedEntries(skipServerId).some(([, entry]) =>
      entry.agents.some((agent) => agentShown(entry, agent) && (entry.reads[agent.id]?.unreadCount ?? 0) > 0),
    );
  }

  return {
    machines,
    /** Reads the agents of a server again. */
    reload: (serverId: string) => void load(serverId),
    markAllRead,
    hasUnread,
  };
}
