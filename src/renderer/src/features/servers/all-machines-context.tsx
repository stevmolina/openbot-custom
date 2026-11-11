import { createEffect, createMemo, createSignal } from "solid-js";
import { usePlatform } from "../../platform";
import { createSimpleContext } from "../../simple-context";
import { createMachinesStore } from "./machines-store";
import { orderServers } from "./server-order";
import { useServers } from "./servers-context";

/** The choice of the view is a choice of this computer, like the server view. */
const ALL_MACHINES_STORAGE_KEY = "openbot:sidebar-all-machines";
const COLLAPSED_STORAGE_KEY = "openbot:sidebar-all-machines-collapsed";

function readActive(): boolean {
  try {
    return window.localStorage.getItem(ALL_MACHINES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** The ids of the closed folders, one per line. A server id holds no line break. */
function readCollapsed(): ReadonlySet<string> {
  try {
    return new Set((window.localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "").split("\n").filter(Boolean));
  } catch {
    return new Set();
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
 * The "All machines" view of the sidebar: the agents of every server at once, one folder per server.
 *
 * It lives above the server scope. A click on an agent of another server switches to that server,
 * and the switch rebuilds the sidebar; the view, its open folders and the agents it read stay, so the
 * list does not load again after each click. Only the main window shows the view: a chat window
 * shows one chat.
 */
const AllMachines = createSimpleContext({
  name: "All machines",
  init: () => {
    const platform = usePlatform();
    const { servers, activeServerId, localServerHidden, retryServerConnection } = useServers();
    const [chosen, setChosen] = createSignal(readActive());
    const [collapsedServerIds, setCollapsedServerIds] = createSignal<ReadonlySet<string>>(readCollapsed());
    /**
     * The server whose new agent form opens once the switch to it lands. New in the view can name a
     * server that is not open, and the sidebar that opens the form is the one of the next scope.
     */
    const [pendingCreateServerId, setPendingCreateServerId] = createSignal<string | null>(null);
    const active = () => chosen() && platform.chatWindow === null;
    const orderedServers = createMemo(() => orderServers(servers(), localServerHidden()));
    const store = createMachinesStore({ servers: orderedServers, enabled: active });
    /**
     * A chat marked read sends no event, so the store does not see the reads made on the open server.
     * The server the user leaves is read again, so its rows and its count show those reads.
     */
    createEffect(activeServerId, (serverId, previousId) => {
      if (previousId && previousId !== serverId && active()) store.reload(previousId);
    });

    function setActive(on: boolean): void {
      setChosen(on);
      save(ALL_MACHINES_STORAGE_KEY, String(on));
    }

    function toggleServer(serverId: string): void {
      const next = new Set(collapsedServerIds());
      if (!next.delete(serverId)) next.add(serverId);
      setCollapsedServerIds(next);
      save(COLLAPSED_STORAGE_KEY, [...next].join("\n"));
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
      collapsedServerIds,
      toggleServer,
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
