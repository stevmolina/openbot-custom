import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../../button";
import type { AgentProfile } from "../../data";
import { ChevronRight } from "../../icons";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

export interface BackgroundWorker {
  id: string;
  agent: AgentProfile | undefined;
  title: string;
  since: string;
  state: "running" | "queued";
  onOpen: () => void;
}

/**
 * Live work owned by the conversation. Only the agent avatar identifies a worker. Rows are keyed
 * by id: the parent rebuilds the list on each streamed token, and a row must update in place
 * instead of remounting, which restarted the avatar animation and flickered.
 */
export function BackgroundWorkers(props: { items: readonly BackgroundWorker[] }) {
  const { t, format } = useText();
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => props.items.length > 0,
    (active) => {
      if (!active) return;
      setNow(Date.now());
      const clock = window.setInterval(() => setNow(Date.now()), 1_000);
      return () => window.clearInterval(clock);
    },
  );
  function elapsed(since: string) {
    const start = Date.parse(since);
    const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((now() - start) / 1_000)) : 0;
    const minutes = format.number(Math.floor(seconds / 60), { style: "unit", unit: "minute", unitDisplay: "narrow" });
    return `${minutes} ${format.number(seconds % 60, { style: "unit", unit: "second", unitDisplay: "narrow" })}`;
  }
  return (
    <Show when={props.items.length > 0}>
      <div class="background-workers">
        <For each={props.items} keyed={(item) => item.id}>
          {(item) => (
            <Button variant="ghost" class="background-worker-row" onClick={() => item().onOpen()}>
              <span class="background-worker-avatar">
                <AgentAvatar agent={item().agent} mood="working" />
                <span class="background-worker-dot" />
              </span>
              <span class="background-worker-copy">
                <span class="background-worker-title">{item().title}</span>
                <span class="background-worker-status">
                  {t(item().state === "running" ? "chat.workers.running" : "chat.workers.queued")}
                </span>
              </span>
              <span class="background-worker-elapsed">{elapsed(item().since)}</span>
              <ChevronRight class="background-worker-chevron" aria-hidden="true" />
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
