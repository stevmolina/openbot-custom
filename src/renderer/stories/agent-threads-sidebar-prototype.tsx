/**
 * Prototype: the sidebar shows each agent like a project, with its threads under it and the state of
 * each thread. Some agents have several copies (instances) of the same agent. The three variants
 * use the same data and differ in how they group it.
 */

import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { ChevronDown, ChevronRight, MessageCircleQuestionMark, ShieldCheck } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";
import { AppSlot, createAppDom, openChat, PrototypeApp } from "./prototype-support";
import "./AgentThreadsSidebarPrototype.css";

type ThreadState = "working" | "approval" | "question" | "done" | "settled";

interface PrototypeThread {
  id: string;
  title: string;
  state: ThreadState;
  time: string;
}

/** One copy of an agent. `instance` names the copy; an agent with one copy has none. */
interface PrototypeInstance {
  agentId: string;
  instance: string | null;
  threads: PrototypeThread[];
}

/** Agents with the same name and face. Copies of one agent share the family. */
interface PrototypeFamily {
  name: string;
  role: string;
  seed: string;
  hue: ClientAgentSummary["avatarHue"];
  instances: PrototypeInstance[];
}

function coderSummary(base: ClientAgentSummary, id: string, instance: string): ClientAgentSummary {
  return {
    ...base,
    id,
    provider: "claude",
    name: "Coder",
    title: instance,
    description: "Writes and reviews code in its own checkout.",
    threadId: `thread-${id}`,
    workspacePath: `/mock/OpenBot/Agents/${id}`,
    preview: "Pushed the fix and opened a pull request.",
    avatarSeed: "coder",
    avatarHue: 150,
  };
}

/** The mock agents: the story agents plus three copies of Coder, so every row opens a real chat. */
export const PROTOTYPE_AGENTS: ClientAgentSummary[] = [
  ...STORY_AGENT_SUMMARIES,
  ...STORY_AGENT_SUMMARIES.slice(0, 1).flatMap((base) => [
    coderSummary(base, "coder-web", "web"),
    coderSummary(base, "coder-api", "api"),
    coderSummary(base, "coder-mobile", "mobile"),
  ]),
];

const FAMILIES: PrototypeFamily[] = [
  {
    name: "Coder",
    role: "Software engineer",
    seed: "coder",
    hue: 150,
    instances: [
      {
        agentId: "coder-web",
        instance: "web",
        threads: [
          { id: "web-login", title: "Fix login redirect", state: "approval", time: "1m" },
          { id: "web-sidebar", title: "Sidebar threads", state: "working", time: "2m" },
          { id: "web-main", title: "Main chat", state: "settled", time: "Mon" },
          { id: "web-dark", title: "Dark mode tokens", state: "settled", time: "Aug 12" },
        ],
      },
      {
        agentId: "coder-api",
        instance: "api",
        threads: [
          { id: "api-rate", title: "Rate limit bug", state: "working", time: "4m" },
          { id: "api-main", title: "Main chat", state: "done", time: "1h" },
        ],
      },
      {
        agentId: "coder-mobile",
        instance: "mobile",
        threads: [
          { id: "mobile-main", title: "Main chat", state: "settled", time: "Aug 18" },
          { id: "mobile-push", title: "Push notifications", state: "settled", time: "Aug 15" },
        ],
      },
    ],
  },
  {
    name: "Chief",
    role: "Chief of staff",
    seed: "chief",
    hue: 245,
    instances: [
      {
        agentId: "chief",
        instance: null,
        threads: [
          { id: "chief-main", title: "Main chat", state: "done", time: "10m" },
          { id: "chief-launch", title: "Q4 launch plan", state: "working", time: "1m" },
          { id: "chief-board", title: "Board update", state: "settled", time: "Aug 17" },
        ],
      },
    ],
  },
  {
    name: "Research",
    role: "Research partner",
    seed: "research",
    hue: 30,
    instances: [
      {
        agentId: "research",
        instance: null,
        threads: [
          { id: "research-pricing", title: "Competitor pricing", state: "question", time: "6m" },
          { id: "research-main", title: "Main chat", state: "settled", time: "Aug 18" },
        ],
      },
    ],
  },
  {
    name: "Sales Outbound",
    role: "Outbound",
    seed: "sales-outbound",
    hue: 320,
    instances: [
      {
        agentId: "sales",
        instance: null,
        threads: [{ id: "sales-main", title: "Main chat", state: "settled", time: "Aug 17" }],
      },
    ],
  },
];

for (const family of FAMILIES) {
  const summary = PROTOTYPE_AGENTS.find((agent) => agent.name === family.name);
  if (summary) {
    family.seed = summary.avatarSeed ?? family.seed;
    family.hue = summary.avatarHue ?? family.hue;
  }
}

const PRECEDENCE: ThreadState[] = ["approval", "question", "working", "done", "settled"];
const STATE_LABEL: Record<ThreadState, string> = {
  approval: "Needs approval",
  question: "Has a question",
  working: "Working",
  done: "Done, not read",
  settled: "Settled",
};

/** The most urgent state among threads: what a closed group shows. */
function topState(threads: readonly PrototypeThread[]): ThreadState {
  for (const state of PRECEDENCE) if (threads.some((thread) => thread.state === state)) return state;
  return "settled";
}

const familyThreads = (family: PrototypeFamily) => family.instances.flatMap((instance) => instance.threads);
const isActive = (thread: PrototypeThread) => thread.state !== "settled";

/** The status mark, with the classes of the real sidebar badge. A settled thread has none. */
function StateMark(props: { state: ThreadState }) {
  return (
    <Show when={props.state !== "settled"} fallback={<span class="atp-mark atp-mark-settled" aria-hidden="true" />}>
      <span
        class={[
          "atp-mark",
          "agent-row-agent-status",
          {
            "agent-row-agent-status-working": props.state === "working",
            "agent-row-agent-status-waiting": props.state === "approval" || props.state === "question",
            "agent-row-agent-status-responded": props.state === "done",
          },
        ]}
        aria-hidden="true"
      >
        <Show when={props.state === "working"}>
          <span class="agent-row-thinking-dots">
            <i />
            <i />
            <i />
          </span>
        </Show>
        <Show when={props.state === "approval"}>
          <ShieldCheck />
        </Show>
        <Show when={props.state === "question"}>
          <MessageCircleQuestionMark />
        </Show>
        <Show when={props.state === "done"}>
          <svg viewBox="0 0 12 12">
            <title>Done</title>
            <path d="m3 6.2 1.8 1.8L9 3.8" />
          </svg>
        </Show>
      </span>
    </Show>
  );
}

function StateChip(props: { state: ThreadState }) {
  return (
    <Show when={props.state === "approval" || props.state === "question"}>
      <span class="atp-chip">{props.state === "approval" ? "Approve" : "Answer"}</span>
    </Show>
  );
}

interface Selection {
  selected: () => string;
  select: (thread: PrototypeThread, agentId: string) => void;
}

/** One thread. `context` is a second line, such as the agent and copy, for the status lanes. */
function ThreadRow(props: {
  thread: PrototypeThread;
  agentId: string;
  selection: Selection;
  depth: 1 | 2;
  avatar?: { seed: string; hue: ClientAgentSummary["avatarHue"] };
  context?: string;
}) {
  return (
    <button
      type="button"
      class={[
        "atp-thread",
        `atp-depth-${props.depth}`,
        { "atp-selected": props.selection.selected() === props.thread.id },
      ]}
      aria-pressed={props.selection.selected() === props.thread.id ? "true" : "false"}
      aria-label={`${props.thread.title}${props.context ? `, ${props.context}` : ""}. ${STATE_LABEL[props.thread.state]}`}
      onClick={() => props.selection.select(props.thread, props.agentId)}
    >
      <Show when={props.avatar} fallback={<StateMark state={props.thread.state} />}>
        {(avatar) => (
          <span class="atp-thread-avatar">
            <AgentAvatar seed={avatar().seed} hue={avatar().hue} motion="idle" />
            <StateMark state={props.thread.state} />
          </span>
        )}
      </Show>
      <span class="atp-thread-copy">
        <span class={["atp-thread-title", { "atp-strong": props.thread.state !== "settled" }]}>
          {props.thread.title}
        </span>
        <Show when={props.context}>
          <span class="atp-thread-context">{props.context}</span>
        </Show>
      </span>
      <Show
        when={props.thread.state === "approval" || props.thread.state === "question"}
        fallback={<span class="atp-time">{props.thread.time}</span>}
      >
        <StateChip state={props.thread.state} />
      </Show>
    </button>
  );
}

/** The active threads, then a "+ N settled" toggle for the rest. */
function ThreadList(props: { instance: PrototypeInstance; selection: Selection; depth: 1 | 2 }) {
  const [showSettled, setShowSettled] = createSignal(false);
  const active = () => props.instance.threads.filter(isActive);
  const settled = () => props.instance.threads.filter((thread) => !isActive(thread));
  const visible = () => (showSettled() ? props.instance.threads : active());
  return (
    <div class="atp-threads">
      <For each={visible()}>
        {(thread) => (
          <ThreadRow thread={thread} agentId={props.instance.agentId} selection={props.selection} depth={props.depth} />
        )}
      </For>
      <Show when={settled().length > 0}>
        <button
          type="button"
          class={["atp-more", `atp-depth-${props.depth}`]}
          aria-expanded={showSettled() ? "true" : "false"}
          onClick={() => setShowSettled((value) => !value)}
        >
          {showSettled() ? "Hide settled" : `+ ${settled().length} settled`}
        </button>
      </Show>
    </div>
  );
}

/** The head row of a group: avatar, name, optional copy badge, and the top state while closed. */
function GroupHead(props: {
  name: string;
  badge?: string | null;
  meta?: string;
  seed: string;
  hue: ClientAgentSummary["avatarHue"];
  open: boolean;
  state: ThreadState;
  activeCount: number;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      class={["atp-group-head", { "atp-group-head-compact": props.compact }]}
      aria-expanded={props.open ? "true" : "false"}
      aria-label={`${props.name}${props.badge ? ` ${props.badge}` : ""}. ${STATE_LABEL[props.state]}`}
      onClick={props.onToggle}
    >
      <span class="atp-chevron" aria-hidden="true">
        <Show when={props.open} fallback={<ChevronRight />}>
          <ChevronDown />
        </Show>
      </span>
      <span class="atp-group-avatar">
        <AgentAvatar seed={props.seed} hue={props.hue} motion="idle" />
        <Show when={!props.open && props.state !== "settled"}>
          <StateMark state={props.state} />
        </Show>
      </span>
      <span class="atp-group-name">
        <strong>{props.name}</strong>
        <Show when={props.badge}>{(badge) => <span class="atp-badge">{badge()}</span>}</Show>
      </span>
      <span class="atp-time">{props.meta ?? (props.activeCount > 0 ? `${props.activeCount} active` : "")}</span>
    </button>
  );
}

/** A. Agent, then copy, then thread. One agent with three copies is one group. */
function NestedFamily(props: { family: PrototypeFamily; selection: Selection }) {
  const threads = () => familyThreads(props.family);
  const [open, setOpen] = createSignal(threads().some(isActive));
  const multi = () => props.family.instances.length > 1;
  return (
    <section class="atp-group" aria-label={props.family.name}>
      <GroupHead
        name={props.family.name}
        meta={multi() ? `${props.family.instances.length} copies` : undefined}
        seed={props.family.seed}
        hue={props.family.hue}
        open={open()}
        state={topState(threads())}
        activeCount={threads().filter(isActive).length}
        onToggle={() => setOpen((value) => !value)}
      />
      <Show when={open()}>
        <Show
          when={multi()}
          fallback={
            <For each={props.family.instances}>
              {(instance) => <ThreadList instance={instance} selection={props.selection} depth={1} />}
            </For>
          }
        >
          <For each={props.family.instances}>
            {(instance) => <NestedInstance instance={instance} selection={props.selection} />}
          </For>
        </Show>
      </Show>
    </section>
  );
}

function NestedInstance(props: { instance: PrototypeInstance; selection: Selection }) {
  const [open, setOpen] = createSignal(props.instance.threads.some(isActive));
  const state = () => topState(props.instance.threads);
  return (
    <div class="atp-instance">
      <button
        type="button"
        class="atp-instance-head"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="atp-chevron" aria-hidden="true">
          <Show when={open()} fallback={<ChevronRight />}>
            <ChevronDown />
          </Show>
        </span>
        <span class="atp-instance-name">{props.instance.instance}</span>
        <Show when={!open()}>
          <StateMark state={state()} />
        </Show>
        <span class="atp-time">{open() ? "" : `${props.instance.threads.length} threads`}</span>
      </button>
      <Show when={open()}>
        <ThreadList instance={props.instance} selection={props.selection} depth={2} />
      </Show>
    </div>
  );
}

/** B. Each copy is its own project, side by side, with the copy name as a badge. */
function FlatInstance(props: { family: PrototypeFamily; instance: PrototypeInstance; selection: Selection }) {
  const [open, setOpen] = createSignal(props.instance.threads.some(isActive));
  return (
    <section class="atp-group" aria-label={`${props.family.name} ${props.instance.instance ?? ""}`}>
      <GroupHead
        name={props.family.name}
        badge={props.instance.instance}
        seed={props.family.seed}
        hue={props.family.hue}
        open={open()}
        state={topState(props.instance.threads)}
        activeCount={props.instance.threads.filter(isActive).length}
        onToggle={() => setOpen((value) => !value)}
      />
      <Show when={open()}>
        <ThreadList instance={props.instance} selection={props.selection} depth={1} />
      </Show>
    </section>
  );
}

const LANES: { title: string; states: ThreadState[] }[] = [
  { title: "Needs you", states: ["approval", "question"] },
  { title: "Working", states: ["working"] },
  { title: "Done", states: ["done"] },
  { title: "Settled", states: ["settled"] },
];

/** C. Threads by state across every agent. The agent and copy are the second line. */
function StatusLanes(props: { selection: Selection }) {
  const all = FAMILIES.flatMap((family) =>
    family.instances.flatMap((instance) => instance.threads.map((thread) => ({ family, instance, thread }))),
  );
  return (
    <For each={LANES}>
      {(lane) => {
        const rows = all.filter((row) => lane.states.includes(row.thread.state));
        const [open, setOpen] = createSignal(lane.title !== "Settled");
        return (
          <Show when={rows.length > 0}>
            <section class="atp-group" aria-label={lane.title}>
              <button
                type="button"
                class="atp-lane-head"
                aria-expanded={open() ? "true" : "false"}
                onClick={() => setOpen((value) => !value)}
              >
                <span class="sidebar-section-name">{lane.title}</span>
                <span class="atp-count">{rows.length}</span>
                <span class="atp-chevron" aria-hidden="true">
                  <Show when={open()} fallback={<ChevronRight />}>
                    <ChevronDown />
                  </Show>
                </span>
              </button>
              <Show when={open()}>
                <For each={rows}>
                  {(row) => (
                    <ThreadRow
                      thread={row.thread}
                      agentId={row.instance.agentId}
                      selection={props.selection}
                      depth={1}
                      avatar={{ seed: row.family.seed, hue: row.family.hue }}
                      context={
                        row.instance.instance ? `${row.family.name} · ${row.instance.instance}` : row.family.name
                      }
                    />
                  )}
                </For>
              </Show>
            </section>
          </Show>
        );
      }}
    </For>
  );
}

/** The real app with the new list in place of the agent list. */
function SidebarPrototypeShell(props: { children: (selection: Selection) => JSX.Element }) {
  const app = createAppDom();
  const [selected, setSelected] = createSignal("web-sidebar");
  const selection: Selection = {
    selected,
    select: (thread, agentId) => {
      setSelected(thread.id);
      const root = app.dom.root;
      if (root) openChat(root, agentId);
    },
  };
  return (
    <div class="agent-threads-sidebar-prototype" ref={app.attach}>
      <PrototypeApp
        options={{ agents: PROTOTYPE_AGENTS }}
        setup={() => {
          queueMicrotask(() => {
            const root = app.dom.root;
            if (root) {
              const observer = new MutationObserver(() => {
                if (openChat(root, "coder-web")) observer.disconnect();
              });
              observer.observe(root, { subtree: true, childList: true });
            }
          });
        }}
      />
      <AppSlot app={app} slot="sidebar">
        <nav class="agent-list atp-list" aria-label="Agents and threads">
          <div class="agent-list-content">{props.children(selection)}</div>
        </nav>
      </AppSlot>
    </div>
  );
}

export function NestedCopiesVariant() {
  return (
    <SidebarPrototypeShell>
      {(selection) => <For each={FAMILIES}>{(family) => <NestedFamily family={family} selection={selection} />}</For>}
    </SidebarPrototypeShell>
  );
}

export function CopyPerProjectVariant() {
  return (
    <SidebarPrototypeShell>
      {(selection) => (
        <For each={FAMILIES}>
          {(family) => (
            <For each={family.instances}>
              {(instance) => <FlatInstance family={family} instance={instance} selection={selection} />}
            </For>
          )}
        </For>
      )}
    </SidebarPrototypeShell>
  );
}

export function StatusLanesVariant() {
  return <SidebarPrototypeShell>{(selection) => <StatusLanes selection={selection} />}</SidebarPrototypeShell>;
}
