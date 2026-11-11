/**
 * The Machines page: every server that the app is connected to, with the agents of each one under it.
 * A server that does not answer shows its state and a retry in place of its agents, so one server that
 * is down does not hide the others. A click on an agent opens it on its server.
 */

import type { ServerConnectionState } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Button, RefreshCw, Settings } from "@openbot/ui";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { FileSearch } from "../files/FileList";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { ServerMark } from "./ServerRail";

/** One agent of a machine, as the page shows it. */
export interface MachineAgent
  extends Pick<AgentProfile, "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"> {
  /** The time of the last message, or `null` for an agent with no messages. */
  updatedAt: string | null;
  /** The messages that the user did not read. */
  unread: number;
  /** The last message, for the sidebar row. The Machines page shows the title instead. */
  preview?: string | undefined;
}

/** The agents of one machine: still loading, not read, or read. */
export type MachineAgents =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; agents: readonly MachineAgent[] };

/** The state of the connection to a machine. A hosted server that sleeps is "sleeping". */
export type MachineState = ServerConnectionState | "sleeping";

export interface Machine {
  id: string;
  name: string;
  logoUrl: string | null;
  state: MachineState;
  /** The server that the sidebar shows now. */
  current: boolean;
  /** The server runs on this computer. */
  thisComputer: boolean;
  agents: MachineAgents;
}

export interface MachinesPageProps {
  /** The machines in the order of the server menu: this computer first. */
  machines: readonly Machine[];
  onOpenAgent: (serverId: string, agentId: string) => void;
  /** Connects to a machine again, or reads its agents again. */
  onRetry: (serverId: string) => void;
  /** Opens the settings of a machine, where its name and logo change. Absent where there are none. */
  onOpenSettings?: ((serverId: string, trigger: HTMLElement) => void) | undefined;
}

export const MACHINE_STATE_LABEL = {
  online: "server.machines.state.online",
  connecting: "server.machines.state.connecting",
  offline: "server.machines.state.offline",
  error: "server.machines.state.error",
  incompatible: "server.machines.state.incompatible",
  sleeping: "server.machines.state.sleeping",
} as const;

/**
 * Why a machine shows no agents: it connects, sleeps, does not answer, or did not give its agents.
 * Null while it is online and its agents load or show. A sleeping hosted server does not answer until
 * it wakes; the retry wakes it.
 */
export function machineUnavailableNotice(machine: Machine): AppTextKey | null {
  if (machine.state === "connecting") return "server.machines.connectingNotice";
  if (machine.state === "sleeping") return "server.machines.sleepingNotice";
  if (machine.state !== "online") return "server.machines.unreachable";
  return machine.agents.status === "failed" ? "server.machines.loadFailed" : null;
}

/** Newest chat first. An agent with no messages goes last, in name order. */
export function byActivity(a: MachineAgent, b: MachineAgent): number {
  if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
  if (a.updatedAt || b.updatedAt) return a.updatedAt ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function matches(agent: MachineAgent, query: string): boolean {
  return agent.name.toLocaleLowerCase().includes(query) || agent.title.toLocaleLowerCase().includes(query);
}

export function MachinesPage(props: MachinesPageProps) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const query = () => search().trim().toLocaleLowerCase();
  const agentCount = createMemo(() =>
    props.machines.reduce(
      (total, machine) => total + (machine.agents.status === "ready" ? machine.agents.agents.length : 0),
      0,
    ),
  );
  /** While the user searches, a machine with no match leaves the page. */
  const shown = createMemo(() =>
    query()
      ? props.machines.filter(
          (machine) =>
            machine.agents.status === "ready" && machine.agents.agents.some((agent) => matches(agent, query())),
        )
      : props.machines,
  );
  return (
    <div class="machines-page">
      <header class="machines-head">
        <div class="machines-heading">
          <h2 class="machines-title">{t("server.machines.title")}</h2>
          <p class="machines-summary">
            {t("server.machines.summary", {
              count: props.machines.length,
              agents: t("server.machines.agentCount", { count: agentCount() }),
            })}
          </p>
        </div>
        <FileSearch class="machines-search" label={t("server.machines.search")} value={search()} onChange={setSearch} />
      </header>
      <Show when={shown().length > 0} fallback={<p class="machines-empty">{t("server.machines.noMatch")}</p>}>
        <div class="machines-list">
          <For each={shown()} keyed={(machine) => machine.id}>
            {(machine) => (
              <MachineSection
                machine={machine()}
                query={query()}
                onOpenAgent={props.onOpenAgent}
                onRetry={props.onRetry}
                onOpenSettings={props.onOpenSettings}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function MachineSection(props: {
  machine: Machine;
  query: string;
  onOpenAgent: MachinesPageProps["onOpenAgent"];
  onRetry: MachinesPageProps["onRetry"];
  onOpenSettings: MachinesPageProps["onOpenSettings"];
}) {
  const { t } = useText();
  const agents = createMemo(() => {
    const list = props.machine.agents;
    if (list.status !== "ready") return [];
    const all = props.query ? list.agents.filter((agent) => matches(agent, props.query)) : list.agents;
    return [...all].sort(byActivity);
  });
  const total = () => (props.machine.agents.status === "ready" ? props.machine.agents.agents.length : null);
  const headingId = () => `machines-${props.machine.id}`;
  return (
    <section class="machines-section" aria-labelledby={headingId()} data-state={props.machine.state}>
      <header class="machines-section-head">
        <span class="machines-logo" aria-hidden="true">
          <ServerMark server={props.machine} />
        </span>
        <div class="machines-section-copy">
          <h3 class="machines-section-name" id={headingId()}>
            {props.machine.name}
          </h3>
          <p class="machines-section-meta">
            <span class="machines-state-dot" aria-hidden="true" />
            <span>{t(MACHINE_STATE_LABEL[props.machine.state])}</span>
            <Show when={props.machine.thisComputer}>
              <span>{t("server.machines.thisComputer")}</span>
            </Show>
            <Show when={total()}>{(count) => <span>{t("server.machines.agentCount", { count: count() })}</span>}</Show>
            <Show when={props.machine.current}>
              <span class="machines-current">{t("server.machines.current")}</span>
            </Show>
          </p>
        </div>
        <Show when={props.onOpenSettings}>
          {(openSettings) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="machines-settings"
              aria-label={t("server.machines.settings", { name: props.machine.name })}
              onClick={(event) => openSettings()(props.machine.id, event.currentTarget)}
            >
              <Settings aria-hidden="true" />
            </Button>
          )}
        </Show>
      </header>
      <Switch>
        <Match when={machineUnavailableNotice(props.machine)}>
          {(notice) => (
            <div class="machines-notice">
              <span>{t(notice())}</span>
              <Show when={props.machine.state !== "connecting"}>
                <Button type="button" variant="outline" size="sm" onClick={() => props.onRetry(props.machine.id)}>
                  <RefreshCw aria-hidden="true" />
                  {t("server.machines.retry")}
                </Button>
              </Show>
            </div>
          )}
        </Match>
        <Match when={props.machine.agents.status === "loading"}>
          <p class="machines-notice">{t("server.machines.loading")}</p>
        </Match>
        <Match when={agents().length === 0}>
          <p class="machines-notice">{t("server.machines.noAgents")}</p>
        </Match>
        <Match when={true}>
          <ul class="machines-agents">
            <For each={agents()} keyed={(agent) => agent.id}>
              {(agent) => (
                <li>
                  <MachineAgentTile agent={agent()} onOpen={() => props.onOpenAgent(props.machine.id, agent().id)} />
                </li>
              )}
            </For>
          </ul>
        </Match>
      </Switch>
    </section>
  );
}

function MachineAgentTile(props: { agent: MachineAgent; onOpen: () => void }) {
  const { t, format } = useText();
  const time = () => (props.agent.updatedAt ? sidebarMessageTime(props.agent.updatedAt, format) : "");
  const label = () =>
    [props.agent.name, props.agent.title, time(), props.agent.unread > 0 ? t("sidebar.chat.unread") : ""]
      .filter(Boolean)
      .join(". ");
  return (
    <Button type="button" variant="ghost" class="machines-agent" aria-label={label()} onClick={() => props.onOpen()}>
      <span class="machines-agent-avatar" aria-hidden="true">
        <AgentAvatar agent={props.agent} motion="hover" />
      </span>
      <span class="machines-agent-copy" aria-hidden="true">
        <strong class="machines-agent-name">{props.agent.name}</strong>
        <span class="machines-agent-detail">{props.agent.title || t("server.machines.noTitle")}</span>
      </span>
      <span class="machines-agent-time" aria-hidden="true">
        {time()}
        <Show when={props.agent.unread > 0}>
          <span class="machines-agent-unread" />
        </Show>
      </span>
    </Button>
  );
}
