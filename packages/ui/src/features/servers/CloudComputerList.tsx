/**
 * The cloud computers of a server's Agent Computer account: one row each, with its state, when it
 * pauses itself, and a button that opens its live view. The live view link is a bearer link: it opens
 * in the user's browser and the list never shows it as text.
 */

import { Button, ExternalLink } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export interface CloudComputer {
  id: string;
  context: string;
  /** `running` or `paused`. Another state shows as it comes. */
  status: string;
  deadlineAt: string | null;
  liveViewUrl: string | null;
}

export interface CloudComputerListProps {
  machines: readonly CloudComputer[];
  onOpenLiveView: (url: string) => void;
}

export function CloudComputerList(props: CloudComputerListProps) {
  return (
    <ul class="cloud-computers">
      <For each={props.machines} keyed={(machine) => machine.id}>
        {(machine) => (
          <li>
            <CloudComputerRow machine={machine()} onOpenLiveView={props.onOpenLiveView} />
          </li>
        )}
      </For>
    </ul>
  );
}

function CloudComputerRow(props: { machine: CloudComputer; onOpenLiveView: (url: string) => void }) {
  const { t, format } = useText();
  const running = () => props.machine.status === "running";
  const state = () =>
    running()
      ? t("server.cloudComputers.running")
      : props.machine.status === "paused"
        ? t("server.cloudComputers.paused")
        : props.machine.status;
  const until = () => {
    const deadline = props.machine.deadlineAt;
    if (!running() || !deadline) return null;
    const time = Date.parse(deadline);
    return Number.isNaN(time) ? null : format.date(time, { hour: "numeric", minute: "2-digit" });
  };
  return (
    <div class="cloud-computer" data-state={running() ? "running" : "paused"}>
      <span class="cloud-computer-dot" aria-hidden="true" />
      <span class="cloud-computer-copy">
        <strong class="cloud-computer-name">{props.machine.context}</strong>
        <span class="cloud-computer-meta">
          <span class="cloud-computer-meta-item">{state()}</span>
          <Show when={until()}>
            {(time) => (
              <span class="cloud-computer-meta-item">{t("server.cloudComputers.until", { time: time() })}</span>
            )}
          </Show>
        </span>
      </span>
      <Show when={props.machine.liveViewUrl}>
        {(url) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("server.cloudComputers.openLiveViewOf", { name: props.machine.context })}
            onClick={() => props.onOpenLiveView(url())}
          >
            <ExternalLink aria-hidden="true" />
            {t("server.cloudComputers.liveView")}
          </Button>
        )}
      </Show>
    </div>
  );
}
