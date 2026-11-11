/**
 * The machine chips and notices of the "All machines" view of the chat list.
 *
 * The chips sit over the list: "All", then one round chip per machine with its logo. The chosen chip
 * shows its name. A dot marks a machine with a chat that waits for the user (warning color) or one
 * that is unread (accent), and a machine that does not answer is dimmed. The chips are one radio
 * group, so the arrow keys move between them.
 *
 * A machine of the choice that does not answer shows one muted line in the list, with a retry, and
 * the other machines still show.
 */

import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { MACHINE_STATE_LABEL, type Machine } from "../servers/MachinesPage";
import { AllMachinesMonogram } from "../servers/ServerMonogram";
import { ServerMark } from "../servers/ServerRail";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarAllMachines } from "./sidebar-types";

/** The machines that the list shows now: the chosen one, or all of them. */
function shownMachines(view: SidebarAllMachines): readonly Machine[] {
  return view.filter === null ? view.machines : view.machines.filter((machine) => machine.id === view.filter);
}

/**
 * The machine of an agent row and of a folder, for the small mark at its end. The mark tells machines
 * apart, so it shows only while the list shows more than one machine.
 */
export function useSidebarMachineMarks() {
  const { props } = useSidebarScope();
  const marksShown = () => {
    const view = props.allMachines;
    return view !== undefined && view.filter === null && view.machines.length > 1;
  };
  const machineById = createMemo(
    () => new Map((props.allMachines?.machines ?? []).map((machine) => [machine.id, machine])),
  );
  return {
    agent: (agentId: string): Machine | undefined => {
      if (!marksShown()) return undefined;
      const serverId = props.allMachines?.agentServers.get(agentId)?.serverId;
      return serverId === undefined ? undefined : machineById().get(serverId);
    },
    section: (sectionId: string): Machine | undefined => {
      if (!marksShown()) return undefined;
      const serverId = props.allMachines?.sectionServers.get(sectionId);
      return serverId === undefined ? undefined : machineById().get(serverId);
    },
  };
}

/** One chip of the group. Only the checked chip is in the tab order; the arrow keys move the choice. */
function MachineChip(chipProps: {
  checked: boolean;
  label: string;
  state?: Machine["state"] | undefined;
  attention?: "waiting" | "unread" | undefined;
  name: string;
  onChoose: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="radio"
      class="sidebar-machine-chip no-drag"
      aria-checked={chipProps.checked ? "true" : "false"}
      aria-label={chipProps.label}
      tabindex={chipProps.checked ? 0 : -1}
      title={chipProps.checked ? undefined : chipProps.name}
      data-state={chipProps.state}
      onClick={() => chipProps.onChoose()}
    >
      <span class="sidebar-machine-chip-mark" aria-hidden="true">
        {chipProps.children}
      </span>
      <Show when={chipProps.checked}>
        <span class="sidebar-machine-chip-name" aria-hidden="true">
          {chipProps.name}
        </span>
      </Show>
      <Show when={chipProps.attention}>
        {(attention) => <span class="sidebar-machine-chip-dot" data-attention={attention()} aria-hidden="true" />}
      </Show>
    </Button>
  );
}

/** The chips over the list: "All", then each machine in the order of the server menu. */
export function SidebarMachineChips(chipsProps: { view: SidebarAllMachines }) {
  const { t } = useText();
  const view = () => chipsProps.view;
  /** The choices in order: null is "All". */
  const choices = createMemo(() => [null, ...view().machines.map((machine) => machine.id)]);
  const choose = (serverId: string | null) => {
    if (serverId !== view().filter) view().onFilterChange(serverId);
  };
  const machineLabel = (machine: Machine) => {
    const attention = view().attention[machine.id];
    return [
      machine.name,
      machine.state === "online" ? "" : t(MACHINE_STATE_LABEL[machine.state]),
      attention === "waiting" ? t("sidebar.waiting.title") : attention === "unread" ? t("sidebar.chat.unread") : "",
    ]
      .filter(Boolean)
      .join(". ");
  };
  let group: HTMLDivElement | undefined;
  // The chosen chip stays in view when the row of chips scrolls sideways.
  createEffect(
    () => chipsProps.view?.filter,
    () => {
      requestAnimationFrame(() =>
        group
          ?.querySelector<HTMLElement>("[aria-checked='true']")
          ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
      );
    },
  );
  /** The arrow keys, Home and End move the choice, and the focus with it, as in a radio group. */
  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const ids = choices();
    const index = ids.indexOf(view().filter);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 }[event.key];
    let next: number | undefined;
    if (step !== undefined) next = (index + step + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    choose(ids[next] ?? null);
    const group = event.currentTarget;
    requestAnimationFrame(() => group.querySelectorAll<HTMLElement>("[role='radio']")[next ?? 0]?.focus());
  };
  return (
    <div
      ref={group}
      class="sidebar-machine-chips"
      role="radiogroup"
      aria-label={t("server.allMachines.filter")}
      onKeyDown={onKeyDown}
    >
      <MachineChip
        checked={view().filter === null}
        label={t("server.allMachines.all")}
        name={t("server.allMachines.all")}
        onChoose={() => choose(null)}
      >
        <AllMachinesMonogram />
      </MachineChip>
      <For each={view().machines} keyed={(machine) => machine.id}>
        {(machine) => (
          <MachineChip
            checked={view().filter === machine().id}
            label={machineLabel(machine())}
            name={machine().name}
            state={machine().state}
            attention={view().attention[machine().id]}
            onChoose={() => choose(machine().id)}
          >
            <ServerMark server={machine()} />
          </MachineChip>
        )}
      </For>
    </div>
  );
}

/** Why a machine of the choice shows no chats, or null while its chats show. */
function machineNotice(
  machine: Machine,
  single: boolean,
  hasRows: boolean,
  t: ReturnType<typeof useText>["t"],
): string | null {
  const name = machine.name;
  if (machine.state === "connecting") return t("server.allMachines.connecting", { name });
  if (machine.state === "sleeping") return t("server.allMachines.sleeping", { name });
  if (machine.state !== "online") return t("server.allMachines.offline", { name });
  if (machine.agents.status === "failed") return t("server.allMachines.loadFailed", { name });
  // "All" shows the other machines while one loads or has no agents, so only one machine says so.
  if (!single) return null;
  if (machine.agents.status === "loading") return t("server.machines.loading");
  return hasRows ? null : t("server.machines.noAgents");
}

/** One muted line for each machine of the choice that shows no chats, with a retry where one helps. */
export function SidebarMachineNotices(noticeProps: { view: SidebarAllMachines }) {
  const { t } = useText();
  const notices = createMemo(() => {
    const single = noticeProps.view.filter !== null;
    // The rows of the list are the agents that the machine shows, the open server's live ones too.
    const withRows = new Set([...noticeProps.view.agentServers.values()].map((ref) => ref.serverId));
    return shownMachines(noticeProps.view).flatMap((machine) => {
      const text = machineNotice(machine, single, withRows.has(machine.id), t);
      return text === null ? [] : [{ machine, text }];
    });
  });
  return (
    <For each={notices()} keyed={(notice) => notice.machine.id}>
      {(notice) => (
        <div class="sidebar-machine-notice">
          <span>{notice().text}</span>
          {/* A machine that connects or loads needs no retry. */}
          <Show
            when={
              notice().machine.state !== "connecting" &&
              !(notice().machine.state === "online" && notice().machine.agents.status !== "failed")
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => noticeProps.view.onRetry(notice().machine.id)}
            >
              {t("server.machines.retry")}
            </Button>
          </Show>
        </div>
      )}
    </For>
  );
}
