import { createEffect, createMemo, createSignal } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { useDynamicIsland } from "../dynamic-island/dynamic-island-context";
import { type AllMachinesSource, machineAgentActivity } from "./all-machines-sidebar";
import { createMachineActivity } from "./machine-activity";
import { createMachinesStore } from "./machines-store";
import { orderServers } from "./server-order";
import { useServers } from "./servers-context";

/** The choices of the view are choices of this computer, like the server view. */
const ALL_MACHINES_STORAGE_KEY = "openbot:sidebar-all-machines";
/** The machine that the view shows, or empty for all of them. */
const FILTER_STORAGE_KEY = "openbot:sidebar-all-machines-filter";
/** The open group of the dock and the closed folders of the view, one id per line. */
const SECTIONS_STORAGE_KEY = "openbot:sidebar-all-machines-sections";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked or full storage keeps the choice for this window only.
  }
}

/**
 * The "All machines" view of the sidebar: the chats of every server in one list, with a chip per
 * machine that shows that machine alone.
 *
 * It lives above the server scope. A click on an agent of another server switches to that server,
 * and the switch rebuilds the sidebar; the view, its filter, its open groups and the agents it read
 * stay, so the list does not load again after each click. Only the main window shows the view: a chat
 * window shows one chat.
 *
 * The open server's chats come from its own live state in the sidebar. This context gives the other
 * servers: their agents, unread counts and folders (`createMachinesStore`), and what their agents do
 * now (`createMachineActivity`).
 */
const AllMachines = createSimpleContext({
  name: "All machines",
  init: () => {
    const platform = usePlatform();
    const { servers, activeServerId, localServerHidden, retryServerConnection } = useServers();
    const { dynamicIslandCoordinator } = useDynamicIsland();
    const [chosen, setChosen] = createSignal(read(ALL_MACHINES_STORAGE_KEY) === "true");
    const [chosenFilter, setChosenFilter] = createSignal(read(FILTER_STORAGE_KEY) || null);
    const [collapsedSectionIds, setCollapsedSectionIds] = createSignal<string[]>(
      (read(SECTIONS_STORAGE_KEY) ?? "").split("\n").filter(Boolean),
    );
    /**
     * The server whose new agent form opens once the switch to it lands. New in the view can name a
     * server that is not open, and the sidebar that opens the form is the one of the next scope.
     */
    const [pendingCreateServerId, setPendingCreateServerId] = createSignal<string | null>(null);
    const active = () => chosen() && platform.chatWindow === null;
    const orderedServers = createMemo(() => orderServers(servers(), localServerHidden()));
    const store = createMachinesStore({ servers: orderedServers, enabled: active });
    const activity = createMachineActivity({ coordinator: dynamicIslandCoordinator, enabled: active, activeServerId });
    /** The chosen machine. One that the app no longer lists shows all of them. */
    const filter = createMemo(() => {
      const serverId = chosenFilter();
      return serverId !== null && orderedServers().some((server) => server.id === serverId) ? serverId : null;
    });

    /**
     * A chat marked read sends no event, so the store does not see the reads made on the open server.
     * The server the user leaves is read again, so its rows and its count show those reads.
     */
    createEffect(activeServerId, (serverId, previousId) => {
      if (previousId && previousId !== serverId && active()) store.reload(previousId);
    });

    // The view asks each server for what its agents do now when it opens and when a server comes
    // online, so its "Needs you" and "Working" do not wait for the next turn.
    const reachable = createMemo(() =>
      active()
        ? orderedServers()
            .filter((server) => server.kind === "local" || server.state === "online")
            .map((server) => server.id)
            .join("\n")
        : "",
    );
    createEffect(reachable, (ids, previous) => {
      const before = new Set(previous ? previous.split("\n") : []);
      for (const serverId of ids ? ids.split("\n") : []) if (!before.has(serverId)) activity.refresh(serverId);
    });

    /** The chats and folders of each server but the open one, by server. */
    const otherSources = createMemo(() => {
      const sources = new Map<string, AllMachinesSource>();
      if (!active()) return sources;
      for (const server of orderedServers()) {
        if (server.id === activeServerId()) continue;
        const entry = store.sidebarEntry(server.id);
        const agents = (entry?.agents ?? []).map(toAgentProfile);
        const unreadReplies = Object.fromEntries(
          Object.entries(entry?.reads ?? {}).map(([agentId, read]) => [agentId, read.unreadCount]),
        );
        const { agentStates, agentMoods } = machineAgentActivity({
          agentIds: agents.map((agent) => agent.id),
          activity: activity.activity(server.id),
          unreadReplies,
        });
        sources.set(server.id, { serverId: server.id, agents, agentStates, agentMoods, layout: entry?.layout ?? null });
      }
      return sources;
    });

    /** The source of every server in the order of the server menu, with `own` for the open server. */
    function sources(own: AllMachinesSource): AllMachinesSource[] {
      const others = otherSources();
      return orderedServers().flatMap((server) => {
        if (server.id === own.serverId) return [own];
        const source = others.get(server.id);
        return source ? [source] : [];
      });
    }

    function setActive(on: boolean): void {
      setChosen(on);
      save(ALL_MACHINES_STORAGE_KEY, String(on));
    }

    function setFilter(serverId: string | null): void {
      setChosenFilter(serverId);
      save(FILTER_STORAGE_KEY, serverId ?? "");
    }

    function toggleSection(sectionId: string): void {
      const current = collapsedSectionIds();
      const next = current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId];
      setCollapsedSectionIds(next);
      save(SECTIONS_STORAGE_KEY, next.join("\n"));
    }

    /** Connects to a joined server that is not online, or reads the agents of an online server again. */
    function retry(serverId: string): void {
      const server = servers().find((candidate) => candidate.id === serverId);
      if (server?.kind === "remote" && server.state !== "online") void retryServerConnection(serverId);
      else store.reload(serverId);
    }

    return {
      active,
      setActive,
      machines: store.machines,
      filter,
      setFilter,
      sources,
      collapsedSectionIds,
      toggleSection,
      retry,
      markAllRead: store.markAllRead,
      hasUnread: store.hasUnread,
      pendingCreateServerId,
      setPendingCreateServerId,
    };
  },
});

export const AllMachinesProvider = AllMachines.provider;
export const useAllMachines = AllMachines.use;
