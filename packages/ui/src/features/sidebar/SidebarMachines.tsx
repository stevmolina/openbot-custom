/**
 * The "All machines" view of the chat list: one folder per server, in the order of the server menu,
 * with the agents of that server newest first. A click on an agent opens its chat on its own server.
 *
 * The agents of the open server use the full chat rows, with their state and their menu. The agents
 * of the other servers show the face, the name and the last message; their menus need their server
 * open, so they have none. A server that does not answer shows its state and a retry in place of its
 * agents, and the other folders stay.
 */

import { Button, ChevronDown, MotionTooltip, RefreshCw } from "@openbot/ui";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  byActivity,
  MACHINE_STATE_LABEL,
  type Machine,
  type MachineAgent,
  machineUnavailableNotice,
} from "../servers/MachinesPage";
import { ServerMark } from "../servers/ServerRail";
import { type SidebarChatLook, SidebarChatRow } from "./SidebarChatRow";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarAllMachines } from "./sidebar-types";

/** The agents of a machine, newest first, or none while they are not read. */
function machineAgents(machine: Machine): MachineAgent[] {
  return machine.agents.status === "ready" ? [...machine.agents.agents].sort(byActivity) : [];
}

/**
 * One agent of the view. An agent of the open server is a full chat row; an agent of another server
 * is a row that opens it there.
 */
function SidebarMachineChat(chatProps: {
  view: SidebarAllMachines;
  machine: Machine;
  agent: MachineAgent;
  look: SidebarChatLook;
}) {
  const { props } = useSidebarScope();
  const profile = () =>
    chatProps.machine.id === chatProps.view.activeServerId
      ? props.agents.find((agent) => agent.id === chatProps.agent.id)
      : undefined;
  return (
    <Show
      when={profile()}
      fallback={
        <SidebarMachineAgentRow
          machine={chatProps.machine}
          agent={chatProps.agent}
          look={chatProps.look}
          onOpen={() => chatProps.view.onOpenAgent(chatProps.machine.id, chatProps.agent.id)}
        />
      }
    >
      {(agent) => <SidebarChatRow chat={{ kind: "agent", id: agent().id, agent: agent() }} look={chatProps.look} />}
    </Show>
  );
}

/** A row of an agent on another server: its face, name and last message, and the server mark. */
function SidebarMachineAgentRow(rowProps: {
  machine: Machine;
  agent: MachineAgent;
  look: SidebarChatLook;
  onOpen: () => void;
}) {
  const { t } = useText();
  const preview = () => rowProps.agent.preview || rowProps.agent.title;
  const label = () =>
    [
      rowProps.agent.name,
      preview().replace(/[.!?…]\s*$/u, ""),
      rowProps.agent.unread > 0 ? t("sidebar.chat.unread") : "",
      t("sidebar.chat.server", { name: rowProps.machine.name }),
    ]
      .filter(Boolean)
      .join(". ");
  const button = () => (
    <Button
      type="button"
      variant="ghost"
      class={rowProps.look === "row" ? "sidebar-chat-row" : "sidebar-chat-face"}
      aria-label={label()}
      data-cuelume-navigate=""
      onClick={() => rowProps.onOpen()}
    >
      <span class="sidebar-chat-avatar">
        <AgentAvatar agent={rowProps.agent} motion="idle" />
      </span>
      <Show when={rowProps.look === "row"}>
        <span class="sidebar-chat-copy" aria-hidden="true">
          <strong class="sidebar-chat-name">{rowProps.agent.name}</strong>
          <span class="sidebar-chat-preview">{preview()}</span>
        </span>
      </Show>
      <Show when={rowProps.agent.unread > 0}>
        <span class="sidebar-chat-unread" aria-hidden="true" />
      </Show>
      <Show when={rowProps.look === "row"}>
        <span class="sidebar-chat-server" title={rowProps.machine.name} aria-hidden="true">
          <ServerMark server={rowProps.machine} />
        </span>
      </Show>
    </Button>
  );
  return (
    <Show when={rowProps.look === "face"} fallback={button()}>
      <MotionTooltip
        class="ui-popover-menu-surface sidebar-chat-tip"
        content={
          <>
            <strong>{rowProps.agent.name}</strong>
            <span>{rowProps.machine.name}</span>
          </>
        }
      >
        {button()}
      </MotionTooltip>
    </Show>
  );
}

/** The folder of one server: a heading that opens and closes it, then its agents or its state. */
function SidebarMachineFolder(folderProps: { view: SidebarAllMachines; machine: Machine }) {
  const { t } = useText();
  const machine = () => folderProps.machine;
  const collapsed = () => folderProps.view.collapsedServerIds.has(machine().id);
  const agents = createMemo(() => machineAgents(machine()));
  const unread = () => agents().filter((agent) => agent.unread > 0).length;
  const notice = () => machineUnavailableNotice(machine());
  const bodyId = () => `sidebar-machine-body-${machine().id}`;
  return (
    <section
      class="sidebar-chat-group sidebar-chat-folder-group sidebar-machine-folder"
      aria-label={machine().name}
      data-state={machine().state}
    >
      <header>
        <Button
          type="button"
          variant="ghost"
          class="sidebar-machine-toggle"
          aria-expanded={collapsed() ? "false" : "true"}
          aria-controls={bodyId()}
          aria-label={
            collapsed()
              ? t("server.allMachines.showAgents", { name: machine().name })
              : t("server.allMachines.hideAgents", { name: machine().name })
          }
          onClick={() => folderProps.view.onToggleServer(machine().id)}
        >
          <span class="sidebar-machine-mark" aria-hidden="true">
            <ServerMark server={machine()} />
          </span>
          <span class="sidebar-machine-name" aria-hidden="true">
            {machine().name}
          </span>
          <Show when={machine().state !== "online"}>
            <span class="sidebar-machine-state" aria-hidden="true">
              {t(MACHINE_STATE_LABEL[machine().state])}
            </span>
          </Show>
          <Show when={unread() > 0}>
            <span class="sidebar-machine-unread" aria-hidden="true">
              {unread()}
            </span>
          </Show>
          <ChevronDown
            class={`sidebar-machine-chevron size-4${collapsed() ? " sidebar-machine-chevron-collapsed" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </header>
      <Show when={!collapsed()}>
        <div id={bodyId()} class="sidebar-chat-rows">
          <Switch>
            <Match when={notice()}>
              {(key) => (
                <div class="sidebar-machine-notice">
                  <span>{t(key())}</span>
                  <Show when={machine().state !== "connecting"}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => folderProps.view.onRetry(machine().id)}
                    >
                      <RefreshCw aria-hidden="true" />
                      {t("server.machines.retry")}
                    </Button>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={machine().agents.status === "loading"}>
              <p class="sidebar-machine-notice">{t("server.machines.loading")}</p>
            </Match>
            <Match when={agents().length === 0}>
              <p class="sidebar-machine-notice">{t("server.machines.noAgents")}</p>
            </Match>
            <Match when={true}>
              <For each={agents()} keyed={(agent) => agent.id}>
                {(agent) => (
                  <SidebarMachineChat view={folderProps.view} machine={machine()} agent={agent()} look="row" />
                )}
              </For>
            </Match>
          </Switch>
        </div>
      </Show>
    </section>
  );
}

/** The open list of the view: a folder for each server. */
export function SidebarMachinesList(listProps: { view: SidebarAllMachines }) {
  return (
    <For each={listProps.view.machines} keyed={(machine) => machine.id}>
      {(machine) => <SidebarMachineFolder view={listProps.view} machine={machine()} />}
    </For>
  );
}

/** The dock of the view: the faces of every agent, server after server. */
export function SidebarMachinesDock(dockProps: { view: SidebarAllMachines }) {
  return (
    <For each={dockProps.view.machines} keyed={(machine) => machine.id}>
      {(machine) => (
        <For each={machineAgents(machine())} keyed={(agent) => agent.id}>
          {(agent) => <SidebarMachineChat view={dockProps.view} machine={machine()} agent={agent()} look="face" />}
        </For>
      )}
    </For>
  );
}
