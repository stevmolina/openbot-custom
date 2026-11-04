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

interface ThreadRef {
  family: PrototypeFamily;
  instance: PrototypeInstance;
  thread: PrototypeThread;
}

const ROWS: ThreadRef[] = FAMILIES.flatMap((family) =>
  family.instances.flatMap((instance) => instance.threads.map((thread) => ({ family, instance, thread }))),
);

const rowOf = (id: string) => ROWS.find((row) => row.thread.id === id);

/** The thread on screen. The prototype always has one, so the first row is only a fallback. */
function currentRow(id: string): ThreadRef {
  const row = rowOf(id) ?? ROWS[0];
  if (!row) throw new Error("The prototype has no threads.");
  return row;
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

const LANES: { title: string; states: ThreadState[] }[] = [
  { title: "Needs you", states: ["approval", "question"] },
  { title: "Working", states: ["working"] },
  { title: "Done", states: ["done"] },
  { title: "Settled", states: ["settled"] },
];

/** C. Threads by state across every agent. The agent and copy are the second line. */
function StatusLanes(props: { selection: Selection }) {
  const all = ROWS;
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
function SidebarPrototypeShell(props: {
  children: (selection: Selection) => JSX.Element;
  header?: (selection: Selection) => JSX.Element;
}) {
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
      <Show when={props.header}>
        {(header) => (
          <AppSlot app={app} slot="header">
            <div class="atp-header">{header()(selection)}</div>
          </AppSlot>
        )}
      </Show>
      <AppSlot app={app} slot="sidebar">
        <nav class="agent-list atp-list" aria-label="Agents and threads">
          <div class="agent-list-content">{props.children(selection)}</div>
        </nav>
      </AppSlot>
    </div>
  );
}

/** The threads that have a tab: the active ones, and the one on screen. */
const tabbed = (instance: PrototypeInstance, selected: string) =>
  instance.threads.filter((thread) => isActive(thread) || thread.id === selected);

/** One tab, in the shape of the real thread tab: the status mark, then the title. */
function Tab(props: {
  row: ThreadRef;
  selection: Selection;
  copyLabel?: boolean;
  avatar?: boolean;
  onClose?: () => void;
}) {
  const selected = () => props.selection.selected() === props.row.thread.id;
  return (
    <span class={["atp-tab", { "atp-tab-selected": selected() }]}>
      <button
        type="button"
        class="atp-tab-button"
        aria-pressed={selected() ? "true" : "false"}
        aria-label={`${props.row.thread.title}, ${props.row.family.name}${props.row.instance.instance ? ` ${props.row.instance.instance}` : ""}. ${STATE_LABEL[props.row.thread.state]}`}
        onClick={() => props.selection.select(props.row.thread, props.row.instance.agentId)}
      >
        <Show when={props.avatar}>
          <span class="atp-tab-avatar">
            <AgentAvatar seed={props.row.family.seed} hue={props.row.family.hue} motion="idle" />
          </span>
        </Show>
        <StateMark state={props.row.thread.state} />
        <span class="atp-tab-title">{props.row.thread.title}</span>
        <Show when={props.copyLabel && props.row.instance.instance}>
          {(label) => <span class="atp-tab-copy">{label()}</span>}
        </Show>
      </button>
      <Show when={props.onClose}>
        {(close) => (
          <button type="button" class="atp-tab-close" aria-label={`Close ${props.row.thread.title}`} onClick={close()}>
            ×
          </button>
        )}
      </Show>
    </span>
  );
}

/** The agent of the thread on screen: its face and name, as the real header starts. */
function AgentHeading(props: { family: PrototypeFamily }) {
  return (
    <span class="atp-heading">
      <span class="atp-heading-avatar">
        <AgentAvatar seed={props.family.seed} hue={props.family.hue} motion="idle" />
      </span>
      <strong>{props.family.name}</strong>
    </span>
  );
}

/** C1. Every copy of the agent on screen, side by side. Each copy is a labeled group of tabs. */
function TabGroupsHeader(props: { selection: Selection }) {
  const current = () => currentRow(props.selection.selected());
  const [folded, setFolded] = createSignal<Record<string, boolean>>({});
  const isFolded = (instance: PrototypeInstance) =>
    folded()[instance.agentId] ??
    !instance.threads.some((thread) => isActive(thread) || thread.id === props.selection.selected());
  return (
    <>
      <AgentHeading family={current().family} />
      <span class="atp-tabs">
        <For each={current().family.instances}>
          {(instance) => (
            <span class="atp-tab-group" data-folded={isFolded(instance) ? "" : undefined}>
              <Show when={instance.instance}>
                {(label) => (
                  <button
                    type="button"
                    class="atp-group-chip"
                    aria-expanded={isFolded(instance) ? "false" : "true"}
                    aria-label={`${current().family.name} ${label()}. ${STATE_LABEL[topState(instance.threads)]}`}
                    onClick={() => setFolded((value) => ({ ...value, [instance.agentId]: !isFolded(instance) }))}
                  >
                    <Show when={isFolded(instance) && topState(instance.threads) !== "settled"}>
                      <StateMark state={topState(instance.threads)} />
                    </Show>
                    {label()}
                    <Show when={isFolded(instance)}>
                      <span class="atp-group-chip-count">{instance.threads.length}</span>
                    </Show>
                  </button>
                )}
              </Show>
              <Show when={!isFolded(instance)}>
                <For
                  each={
                    folded()[instance.agentId] === false
                      ? instance.threads
                      : tabbed(instance, props.selection.selected())
                  }
                >
                  {(thread) => <Tab row={{ family: current().family, instance, thread }} selection={props.selection} />}
                </For>
              </Show>
            </span>
          )}
        </For>
      </span>
    </>
  );
}

/** C2. The tabs of one copy, and a switcher to the other copies beside the agent name. */
function CopySwitcherHeader(props: { selection: Selection }) {
  const current = () => currentRow(props.selection.selected());
  const [open, setOpen] = createSignal(false);
  const others = () => current().family.instances.filter((instance) => instance !== current().instance);
  const otherState = () => topState(others().flatMap((instance) => instance.threads));
  const switchTo = (instance: PrototypeInstance) => {
    setOpen(false);
    const thread = instance.threads.find(isActive) ?? instance.threads[0];
    if (thread) props.selection.select(thread, instance.agentId);
  };
  return (
    <>
      <AgentHeading family={current().family} />
      <Show when={current().instance.instance}>
        {(label) => (
          <span class="atp-switcher">
            <button
              type="button"
              class="atp-group-chip atp-switcher-button"
              aria-expanded={open() ? "true" : "false"}
              aria-label={`Copy ${label()}. Switch copy`}
              onClick={() => setOpen((value) => !value)}
            >
              {label()}
              <ChevronDown />
              <Show when={otherState() !== "settled" && otherState() !== "done"}>
                <span class="atp-switcher-dot" aria-hidden="true" />
              </Show>
            </button>
            <Show when={open()}>
              <div class="atp-switcher-menu">
                <For each={current().family.instances}>
                  {(instance) => (
                    <button
                      type="button"
                      class={["atp-switcher-item", { "atp-selected": instance === current().instance }]}
                      onClick={() => switchTo(instance)}
                    >
                      <StateMark state={topState(instance.threads)} />
                      <span class="atp-tab-title">
                        {current().family.name} · {instance.instance}
                      </span>
                      <span class="atp-time">{instance.threads.filter(isActive).length} active</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </span>
        )}
      </Show>
      <span class="atp-tabs">
        <For each={tabbed(current().instance, props.selection.selected())}>
          {(thread) => (
            <Tab row={{ family: current().family, instance: current().instance, thread }} selection={props.selection} />
          )}
        </For>
      </span>
    </>
  );
}

/** C3. Tabs as in a browser: any thread of any agent or copy, in the order the user opened them. */
function OpenTabsHeader(props: { selection: Selection }) {
  const [open, setOpen] = createSignal<string[]>(["web-sidebar", "web-login", "api-rate", "research-pricing"]);
  const opened = () => {
    const id = props.selection.selected();
    return open().includes(id) ? open() : [...open(), id];
  };
  return (
    <span class="atp-tabs">
      <For each={opened()}>
        {(id) => (
          <Show when={rowOf(id)}>
            {(row) => (
              <Tab
                row={row()}
                selection={props.selection}
                avatar
                copyLabel
                onClose={() => setOpen(opened().filter((other) => other !== id))}
              />
            )}
          </Show>
        )}
      </For>
    </span>
  );
}

const lanes = (selection: Selection) => <StatusLanes selection={selection} />;

export function StatusLanesVariant() {
  return <SidebarPrototypeShell>{lanes}</SidebarPrototypeShell>;
}

export function TabGroupsVariant() {
  return (
    <SidebarPrototypeShell header={(selection) => <TabGroupsHeader selection={selection} />}>
      {lanes}
    </SidebarPrototypeShell>
  );
}

export function CopySwitcherVariant() {
  return (
    <SidebarPrototypeShell header={(selection) => <CopySwitcherHeader selection={selection} />}>
      {lanes}
    </SidebarPrototypeShell>
  );
}

export function OpenTabsVariant() {
  return (
    <SidebarPrototypeShell header={(selection) => <OpenTabsHeader selection={selection} />}>
      {lanes}
    </SidebarPrototypeShell>
  );
}
