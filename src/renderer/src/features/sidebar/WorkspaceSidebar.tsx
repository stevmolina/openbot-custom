import type { ChatWindowTarget } from "@openbot/contracts/ipc";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CONVERSATION_UNREAD_FROM_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarCommunityCard } from "@openbot/ui/features/sidebar/SidebarCommunityCard";
import { SidebarMobileAppCard } from "@openbot/ui/features/sidebar/SidebarMobileAppCard";
import { sidebarChannelWaits } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { appPort } from "../../app-port";
import { type ChatHistoryEntry, chatHistoryKeys } from "../../chat-history";
import { useLayout } from "../../layout";
import { DirectConversation } from "../../lazy-views";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useAgentActions } from "../agents/agent-actions";
import { createAgentActivity } from "../agents/agent-activity";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useAllMachines } from "../servers/all-machines-context";
import { mergeAllMachinesSidebar } from "../servers/all-machines-sidebar";
import { useOpenMachineAgent } from "../servers/machine-agent-open";
import { useServerActions } from "../servers/server-actions";
import { serverRoleCanAdminister } from "../servers/server-capabilities";
import { useServerScope } from "../servers/server-scope";
import { useServerSettings } from "../servers/server-settings";
import { serverUpdateBadge, showServerUpdate } from "../servers/server-update-flow";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { onShortcutCommand } from "../shortcuts/shortcut-commands";
import { usePresence } from "../team/team-context";
import { SidebarUpdateIsland } from "../updates/SidebarUpdateIsland";
import { useWindowPage } from "../window/window-page-context";
import { useWorkspaceSidebarPages } from "../window/workspace-sidebar-pages";
import { createCommunityCardVisibility } from "./community-card";
import { useCustomSidebarThreadLanes } from "./custom-sidebar-thread-lanes";
import { createSidebarAlertCards, SidebarAlertCards } from "./SidebarAlertCards";
import { ServerUpgradeOffer } from "./server-upgrade-offer";
import { useSidebar } from "./sidebar-context";

/** Dismissing the mobile app card is a choice of this computer, like the sidebar width. The key is
 * new with the Android release, so a computer that dismissed the iPhone-only card sees it once more. */
const MOBILE_APP_DISMISSED_STORAGE_KEY = "openbot:mobile-app-card-dismissed";

/**
 * The list of Agents and people. It reads the most domains of any pane, and every
 * one of them for the same reason: a sidebar row shows who exists, who is
 * working, who has replied and who is pinned, which is four domains before any
 * of the actions on the row context menu.
 *
 * `peopleEnabled` arrives as a prop because the shell already computes it to
 * decide which pane renders. Deriving it a second time here would let the two
 * answers disagree for a frame.
 */
export function WorkspaceSidebar(props: { peopleEnabled: boolean }) {
  const { t } = useText();
  const layout = useLayout();
  const platform = usePlatform();
  const channels = useChannels();
  const serverScope = useServerScope();
  const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
  // The chats that main shows in a window of their own. Main sends the list on each change.
  const [chatWindows, setChatWindows] = createSignal<ChatWindowTarget[]>([]);
  onSettled(() => {
    const unsubscribe = appPort().onChatWindows(setChatWindows);
    void appPort()
      .getChatWindows()
      .then(setChatWindows)
      .catch(() => undefined);
    return unsubscribe;
  });
  const windowAgentIds = createMemo(
    () => new Set(chatWindows().flatMap((target) => (target.serverId === activeServerId() ? [target.agentId] : []))),
  );
  const { openServerSettings, serverSettingsOpen } = useServerSettings();
  const serverActions = useServerActions();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const {
    agentList,
    agentListConnecting,
    agentListSettled,
    activeAgent,
    agentSetupDraft,
    duplicatingAgentIds,
    openAgentSetup,
    userHiddenAgents,
    userHiddenAgentIds,
    userPausedAgentIds,
    userHiddenAgentsWork,
    mutedAgentIds,
  } = useAgents();
  const {
    editAgent,
    duplicateAgent,
    duplicateSection,
    duplicatingSectionIds,
    deleteAgent,
    setAgentHiddenByUser,
    setAgentMuted,
  } = useAgentActions();
  // A server that keeps no levels has no mute item: the item must not fail.
  const muteSupported = () => activeServerSupportsCapability(AGENT_NOTIFICATION_LEVELS_CAPABILITY);
  // The host refuses a member: an agent is hidden for every member.
  const hideAllowed = () =>
    activeServerSupportsCapability(AGENT_HIDDEN_CAPABILITY) && serverRoleCanAdminister(activeServer());
  const { pendingPrompts, approvals } = useTurns();
  const { agentUnreadReplies, markAgentChatRead, markAgentChatUnread, markAllAgentMessagesRead } = useConversation();
  const { directPeople, teamPresence } = usePresence();
  const { activeDirectMember, activeDirectMemberId, directThreads } = useDirectMessages();
  const { selectAgent, selectDirectMember, setGlobalSearchVisibility, chatHistory } = useNavigation();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();
  const threadLanes = useCustomSidebarThreadLanes({
    agentList,
    activeServerId,
    shownAgent: () => (activeDirectMember() || channels.state.selectedId ? undefined : activeAgent()),
  });
  const pages = useWorkspaceSidebarPages();
  const windowPage = useWindowPage();
  const allMachines = useAllMachines();
  const machineAgents = useOpenMachineAgent();
  // The agent menu offers Mark read for these. The count also holds the side threads, as the badge does.
  const unreadAgentIds = createMemo(
    () => new Set(agentList().flatMap((agent) => ((agentUnreadReplies()[agent.id] ?? 0) > 0 ? [agent.id] : []))),
  );
  /**
   * Opens the agent's chat with a new thread. A host without threads has no such item, and neither has a
   * chat window: another agent opens in a window of its own, which does not get the new thread.
   */
  const newAgentThread = () =>
    agentTasks.available() && !platform.chatWindow
      ? (agentId: string) => {
          if (selectAgent(agentId)) agentThreads.startNew(agentId);
        }
      : undefined;
  /** What Back opens: the list of an open settings detail page, or else the previous chat. */
  const backTarget = (): { name: string } | null => {
    const pageBack = chatHistory.pageBack();
    return pageBack ? { name: pageBack.name } : chatName(chatHistory.previous());
  };
  /** The name of a chat as its sidebar row shows it. */
  const chatName = (entry: ChatHistoryEntry | undefined): { name: string } | null => {
    if (!entry) return null;
    if (entry.kind === "agent") return { name: agentList().find((agent) => agent.id === entry.id)?.name ?? "" };
    if (entry.kind === "channel") {
      return { name: channels.state.channels.find((channel) => channel.id === entry.id)?.name ?? "" };
    }
    const member = directPeople().find((person) => person.id === entry.id);
    return { name: member ? teamMemberName(member) : "" };
  };
  const {
    sidebarLayout,
    collapsedSidebarSectionIds,
    mutateSidebarLayout,
    toggleSidebarSection,
    pinnedSidebarItems,
    sidebarPeopleOrder,
    pinSidebarItem,
    unpinSidebarItem,
    reorderPinnedSidebarItems,
    reorderSidebarPeople,
  } = useSidebar();
  const [mobileAppDismissed, setMobileAppDismissed] = createSignal(
    window.localStorage.getItem(MOBILE_APP_DISMISSED_STORAGE_KEY) === "true",
  );
  const communityCard = createCommunityCardVisibility();
  const alertCards = createSidebarAlertCards(activeServer);
  // A clear in Server settings frees space and can change an alert level, so both cards read
  // again when settings close.
  createEffect(serverSettingsOpen, (open, wasOpen) => {
    if (!open && wasOpen) alertCards.refresh();
  });

  /* Channels reach the sidebar as data, not as a list of their own: they sit in the layout's
   * sections beside the agents, so the sidebar has to be able to order and group them. The Routines
   * view lists only agents: a channel has no routine canvas. */
  const channelsListed = () => channels.supported() && layout.sidebarView() !== "routines";
  /* Until a joined server lists channels, the frame's rows hold their place, so the agents below stay. */
  const sidebarChannels = () =>
    !channels.state.listed &&
    layout.sidebarView() !== "routines" &&
    (!serverScope.loaded() || channels.supported()) &&
    serverScope.frameChannels().length > 0
      ? serverScope.frameChannels()
      : channelsListed()
        ? channels.state.channels
        : [];
  const visibleChannels = createMemo(() => sidebarChannels().filter((channel) => !channel.archived));
  /* A channel can open while the Routines view is on: from search, a notification, or a selection
   * restored at start. Its row must be in the list, so the list goes back to the agents view. */
  createEffect(
    () => layout.sidebarView() === "routines" && channels.state.selectedId !== null,
    (channelOpenInRoutines) => {
      if (channelOpenInRoutines) layout.setSidebarView("agents");
    },
  );

  const { agentStates: sidebarAgentStates, agentMoods } = createAgentActivity();

  /* A wait in a channel thread goes to the channel instead. Selecting the channel opens the view
   * that answers it. */
  const channelWaits = createMemo(() => {
    const prompts = Object.values(pendingPrompts());
    return sidebarChannelWaits({
      channels: visibleChannels(),
      prompts: prompts.flatMap((event) => (event?.type === "prompt" ? [event] : [])),
      takeovers: prompts.flatMap((event) => (event?.type === "browser-takeover-requested" ? [event.request] : [])),
      approvals: approvals(),
    });
  });

  /** Opens the new agent form of the open server, on the agents page. */
  const createAgentHere = () => {
    // New shows on every page now, so the agent form opens on the agents page.
    windowPage.showAgents();
    channels.close();
    openAgentSetup();
  };
  // ⌘N and the New Chat menu item do what the sidebar's New does.
  onSettled(() =>
    onShortcutCommand("newChat", () => {
      createAgentHere();
      return true;
    }),
  );

  /**
   * New in the "All machines" view names a server. The form of another server opens after the switch
   * to it, in the sidebar of that server, which reads the request here.
   */
  async function createAgentOn(serverId: string): Promise<void> {
    if (serverId === activeServerId()) {
      createAgentHere();
      return;
    }
    allMachines.setPendingCreateServerId(serverId);
    // A second click can start a newer switch to the same server; this one then fails, and the
    // request stays for the newer switch.
    if (!(await machineAgents.switchTo(serverId)) && allMachines.pendingCreateServerId() === serverId) {
      allMachines.setPendingCreateServerId(null);
    }
  }
  createEffect(
    () => allMachines.pendingCreateServerId() !== null && allMachines.pendingCreateServerId() === activeServerId(),
    (landed) => {
      if (!landed) return;
      allMachines.setPendingCreateServerId(null);
      createAgentHere();
    },
  );

  /**
   * The "All machines" view: the chats and folders of the chosen machines as one list. The open
   * server gives its live agents, states and folders; the context gives the other servers. Channels,
   * pins and people belong to one server, so the view has none of them.
   */
  const allMachinesOn = () => allMachines.active();
  const allMachinesSidebar = createMemo(() => {
    if (!allMachinesOn()) return undefined;
    const hidden = userHiddenAgentIds();
    return mergeAllMachinesSidebar({
      sources: allMachines.sources({
        serverId: activeServerId(),
        agents: agentList().filter((agent) => !hidden.has(agent.id)),
        // A hidden agent has no row, so it must not light the dot of its machine's chip either.
        agentStates: Object.fromEntries(
          Object.entries(sidebarAgentStates()).filter(([agentId]) => !hidden.has(agentId)),
        ),
        agentMoods: agentMoods(),
        layout: sidebarLayout(),
        threadWaits: threadLanes()?.threads.some(
          (entry) => entry.state.kind === "waiting" && !hidden.has(entry.agentId),
        ),
      }),
      activeServerId: activeServerId(),
      filter: allMachines.filter(),
    });
  });

  return (
    <>
      <Sidebar
        channels={allMachinesOn() ? [] : visibleChannels()}
        deletedChannels={allMachinesOn() ? [] : sidebarChannels().filter((channel) => channel.archived)}
        activeChannelId={channels.state.selectedId}
        onSelectChannel={(id) => void channels.open(id)}
        onEditChannel={(id) => void channels.editChannel(id)}
        onDeleteChannel={channels.deletionSupported() ? channels.remove : undefined}
        onRestoreChannel={channels.deletionSupported() ? channels.restore : undefined}
        showingArchivedChannels={channelsListed() && !allMachinesOn() && channels.state.archived}
        onToggleArchivedChannels={channelsListed() && !allMachinesOn() ? channels.toggleArchived : undefined}
        onCreateChannel={channelsListed() && !allMachinesOn() ? channels.create : undefined}
        onMarkAllRead={() => {
          // In "All machines", Mark all read reads the chats that the chips show: every server, or
          // the one chosen. A chosen server that is not open keeps the chats of the open one.
          const filter = allMachinesOn() ? allMachines.filter() : null;
          if (filter === null || filter === activeServerId()) {
            void markAllAgentMessagesRead();
            if (filter === null) void channels.markAllRead();
          }
          if (allMachinesOn() && filter !== activeServerId()) void allMachines.markAllRead(activeServerId(), filter);
        }}
        hasUnread={(() => {
          const filter = allMachinesOn() ? allMachines.filter() : null;
          const ownUnread = agentList().some(
            (agent) => !userPausedAgentIds().has(agent.id) && (agentUnreadReplies()[agent.id] ?? 0) > 0,
          );
          if (filter === activeServerId()) return ownUnread;
          if (filter !== null) return allMachines.hasUnread(activeServerId(), filter);
          return ownUnread || channels.hasUnread() || (allMachinesOn() && allMachines.hasUnread(activeServerId()));
        })()}
        view={layout.sidebarView()}
        serverName={
          allMachinesOn() ? t("server.allMachines.title") : (activeServer()?.name ?? t("sidebar.topbar.localServer"))
        }
        onOpenServerSettings={(trigger) => {
          const server = activeServer();
          if (server) openServerSettings(server.id, trigger);
        }}
        chatHistory={{
          back: backTarget(),
          forward: chatName(chatHistory.next()),
          keys: chatHistoryKeys(platform.appInfo()?.platform === "darwin"),
          onBack: chatHistory.goBack,
          onForward: chatHistory.goForward,
        }}
        serverUpdate={(() => {
          const server = activeServer();
          const badge = server ? serverUpdateBadge(server.id) : null;
          return server && badge ? { ...badge, onOpen: () => void showServerUpdate(server.id) } : undefined;
        })()}
        serverMenu={
          platform.appInfo()
            ? {
                servers: serverActions.orderedServers(),
                view: layout.serverView(),
                onViewChange: layout.setServerView,
                // A server row leaves the "All machines" view, the row of the open server too.
                onSelect: (serverId: string) => {
                  allMachines.setActive(false);
                  if (serverId !== activeServerId()) serverActions.select(serverId);
                },
                allMachines: { active: allMachinesOn(), onSelect: () => allMachines.setActive(true) },
                onAdd: serverActions.add,
                onCreateLocal: serverActions.addMenuCreateLocal(),
                onInstallServer: serverActions.addMenuInstallServer(),
                addCreatesServer: serverActions.addCreatesServer(),
                hiddenLocal: serverActions.hiddenLocal(),
                ...serverActions.callbacks,
              }
            : undefined
        }
        chatServer={(() => {
          // One server needs no mark: every chat is on it. The "All machines" view marks each row itself.
          const server = activeServer();
          if (allMachinesOn()) return undefined;
          return server && serverActions.orderedServers().length > 1
            ? {
                id: server.id,
                name: server.name,
                logoUrl: server.logoUrl,
                kind: server.kind,
                thisComputer: server.thisComputer === true,
              }
            : undefined;
        })()}
        machineChips={
          // The chips switch the view in the main window: "All" is the "All machines" view, and a
          // machine is its own chat list, with its channels, pins and people.
          platform.chatWindow === null && allMachines.machines().length > 1
            ? {
                machines: allMachines.machines(),
                chosen: allMachinesOn() ? null : activeServerId(),
                attention: allMachinesSidebar()?.attention ?? {},
                onChoose: (serverId: string | null) => {
                  allMachines.setFilter(null);
                  if (serverId === null) {
                    allMachines.setActive(true);
                    return;
                  }
                  allMachines.setActive(false);
                  if (serverId !== activeServerId()) serverActions.select(serverId);
                },
              }
            : undefined
        }
        allMachines={(() => {
          const view = allMachinesSidebar();
          return view
            ? {
                machines: allMachines.machines(),
                activeServerId: activeServerId(),
                filter: allMachines.filter(),
                onFilterChange: allMachines.setFilter,
                attention: view.attention,
                agentServers: view.agentServers,
                sectionServers: view.sectionServers,
                onOpenAgent: (serverId, agentId) => void machineAgents.openAgent(serverId, agentId),
                onRetry: allMachines.retry,
                onCreateAgent: (serverId) => void createAgentOn(serverId),
              }
            : undefined;
        })()}
        agents={allMachinesSidebar()?.agents ?? agentList()}
        activeAgentId={activeDirectMember() || channels.state.selectedId ? "" : (activeAgent()?.id ?? "")}
        showPeople={props.peopleEnabled && !allMachinesOn()}
        people={directPeople()}
        directThreads={directThreads()}
        activeDirectMemberId={activeDirectMemberId()}
        agentStates={allMachinesSidebar()?.agentStates ?? sidebarAgentStates()}
        channelWaits={channelWaits()}
        channelPreviewsPending={!channels.state.listed}
        agentMoods={allMachinesSidebar()?.agentMoods ?? agentMoods()}
        layout={allMachinesSidebar()?.layout ?? sidebarLayout()}
        layoutMutable={!allMachinesOn() && activeServerSupportsCapability("sidebar-layout")}
        chatOrder={layout.sidebarChatOrder()}
        onChatOrderChange={layout.setSidebarChatOrder}
        foldersSupported={activeServerSupportsCapability("sidebar-folders-v1")}
        collapsedSectionIds={allMachinesOn() ? allMachines.collapsedSectionIds() : collapsedSidebarSectionIds()}
        onMutateLayout={mutateSidebarLayout}
        sectionDuplicateSupported={
          activeServerSupportsCapability("agent-duplication") && activeServerSupportsCapability("sidebar-layout")
        }
        duplicatingSectionIds={duplicatingSectionIds()}
        onDuplicateSection={duplicateSection}
        onToggleSection={allMachinesOn() ? allMachines.toggleSection : toggleSidebarSection}
        pinnedItems={allMachinesOn() ? [] : pinnedSidebarItems()}
        peopleOrder={sidebarPeopleOrder()}
        onPin={pinSidebarItem}
        onUnpin={unpinSidebarItem}
        onReorderPinned={reorderPinnedSidebarItems}
        onReorderPeople={reorderSidebarPeople}
        onSelectAgent={selectAgent}
        onSelectPerson={(memberId) => void selectDirectMember(memberId)}
        onPreloadDirectConversation={props.peopleEnabled ? () => void DirectConversation.preload() : undefined}
        onCreateAgent={createAgentHere}
        onEditAgent={editAgent}
        duplicateSupported={activeServerSupportsCapability("agent-duplication")}
        duplicatingAgentIds={duplicatingAgentIds()}
        onDuplicateAgent={duplicateAgent}
        onDeleteAgent={deleteAgent}
        userHiddenAgents={allMachinesOn() ? [] : userHiddenAgents()}
        userHiddenAgentsWork={userHiddenAgentsWork()}
        threadLanes={threadLanes()}
        unreadAgentIds={unreadAgentIds()}
        onMarkAgentRead={(agentId) => void markAgentChatRead(agentId)}
        onMarkAgentUnread={
          activeServerSupportsCapability(CONVERSATION_UNREAD_FROM_CAPABILITY)
            ? (agentId) => void markAgentChatUnread(agentId)
            : undefined
        }
        mutedAgentIds={muteSupported() ? mutedAgentIds() : undefined}
        onSetAgentMuted={muteSupported() ? (agentId, muted) => void setAgentMuted(agentId, muted) : undefined}
        onHideAgent={hideAllowed() ? (agentId) => void setAgentHiddenByUser(agentId, true) : undefined}
        onRestoreAgent={hideAllowed() ? (agentId) => void setAgentHiddenByUser(agentId, false) : undefined}
        onNewAgentThread={newAgentThread()}
        onOpenAgentWindow={
          platform.landingPreview
            ? undefined
            : (agentId) => void appPort().openChatWindow({ serverId: activeServerId(), agentId })
        }
        windowAgentIds={windowAgentIds()}
        compact={layout.leftPanelCompact()}
        pages={pages()}
        onExpand={layout.expandSidebar}
        onCollapse={() => layout.setSidebarClosed(true)}
        onOpenSearch={() => setGlobalSearchVisibility(true)}
        footer={
          <>
            {/* One card at a time. A machine over its alert level comes first, then a disk that is
             * almost full; the community card waits until the mobile app card is dismissed. */}
            <SidebarAlertCards
              cards={alertCards}
              serverName={activeServer()?.name ?? ""}
              members={teamPresence().members}
              onOpenStorage={(serverId) => openServerSettings(serverId, null, "storage")}
            />
            <Show when={!platform.landingPreview && !alertCards.shown() && !mobileAppDismissed()}>
              <SidebarMobileAppCard
                onOpenInstall={() => openAppSettings(null, "mobile-connect")}
                onDismiss={() => {
                  window.localStorage.setItem(MOBILE_APP_DISMISSED_STORAGE_KEY, "true");
                  setMobileAppDismissed(true);
                }}
              />
            </Show>
            <Show
              when={
                !platform.landingPreview && !alertCards.shown() && mobileAppDismissed() && !communityCard.dismissed()
              }
            >
              <SidebarCommunityCard
                onJoinDiscord={() => void appPort().openExternal("discord")}
                onFollowX={() => void appPort().openExternal("x")}
                onDismiss={communityCard.dismiss}
              />
            </Show>
            <SidebarUpdateIsland />
          </>
        }
        onOpenMarketplace={() => setSkillsMarketplaceOpen(true)}
        agentsConnecting={agentListConnecting()}
        emptyAction={
          agentList().length === 0 && agentListSettled()
            ? {
                label: t("sidebar.empty.firstAgent"),
                avatarSeed: agentSetupDraft().avatarSeed,
                avatarHue: agentSetupDraft().avatarHue,
                avatarColor: agentSetupDraft().avatarColor ?? null,
                onSelect: () => {
                  channels.close();
                  openAgentSetup();
                },
              }
            : undefined
        }
      />
      {/* A compact sidebar hides the footer card, so the offer is outside the footer. */}
      <ServerUpgradeOffer
        card={alertCards.storageCard.card()}
        server={activeServer()}
        blocked={serverSettingsOpen()}
        onFreeUpSpace={(serverId) => openServerSettings(serverId, null, "storage")}
      />
    </>
  );
}
