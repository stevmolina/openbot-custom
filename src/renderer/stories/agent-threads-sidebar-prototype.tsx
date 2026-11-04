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

const STATE_LABEL: Record<ThreadState, string> = {
  approval: "Needs approval",
  question: "Has a question",
  working: "Working",
  done: "Done, not read",
  settled: "Settled",
};

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
];

/** C. Threads by state across every agent. The agent and copy are the second line. */
function StatusLanes(props: { selection: Selection }) {
  const all = ROWS;
  return (
    <For each={LANES}>
      {(lane) => {
        const rows = all.filter((row) => lane.states.includes(row.thread.state));
        const [open, setOpen] = createSignal(true);
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

/**
 * The quiet bots: one entry per bot, its main agent only. Copies and old threads stay out, because
 * they show in the lists above only while they need you or work. A click opens the main chat.
 */
function AgentsSection(props: { selection: Selection; layout: "list" | "grid" }) {
  const main = (family: PrototypeFamily) => {
    const instance = family.instances[0];
    const thread = instance?.threads.find((candidate) => candidate.title === "Main chat") ?? instance?.threads[0];
    return instance && thread ? { instance, thread } : undefined;
  };
  const [open, setOpen] = createSignal(true);
  return (
    <section class="atp-group atp-agents" aria-label="Agents">
      <button
        type="button"
        class="atp-lane-head"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="sidebar-section-name">Agents</span>
        <span class="atp-count">{FAMILIES.length}</span>
        <span class="atp-chevron" aria-hidden="true">
          <Show when={open()} fallback={<ChevronRight />}>
            <ChevronDown />
          </Show>
        </span>
      </button>
      <Show when={open()}>
        <div class={props.layout === "grid" ? "atp-agent-grid" : "atp-agent-list"}>
          <For each={FAMILIES}>
            {(family) => (
              <Show when={main(family)}>
                {(entry) => (
                  <button
                    type="button"
                    class={["atp-agent", { "atp-selected": props.selection.selected() === entry().thread.id }]}
                    aria-label={`${family.name}, ${family.role}. Open the main chat`}
                    onClick={() => props.selection.select(entry().thread, entry().instance.agentId)}
                  >
                    <span class="atp-agent-avatar">
                      <AgentAvatar seed={family.seed} hue={family.hue} motion="idle" />
                    </span>
                    <span class="atp-agent-name">{family.name}</span>
                    <Show when={props.layout === "list"}>
                      <span class="atp-agent-role">{family.role}</span>
                    </Show>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </section>
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

/**
 * One tab: the agent's face with the thread state on its corner, the title, and the copy as a gray
 * word. A tab of an agent with one copy has no word.
 */
function Tab(props: { row: ThreadRef; selection: Selection; onClose: () => void }) {
  const selected = () => props.selection.selected() === props.row.thread.id;
  const copy = () => props.row.instance.instance;
  return (
    <span
      class={["atp-tab", { "atp-tab-selected": selected(), "atp-tab-settled": props.row.thread.state === "settled" }]}
    >
      <button
        type="button"
        class="atp-tab-button"
        aria-pressed={selected() ? "true" : "false"}
        aria-label={`${props.row.thread.title}, ${props.row.family.name}${copy() ? ` ${copy()}` : ""}. ${STATE_LABEL[props.row.thread.state]}`}
        onClick={() => props.selection.select(props.row.thread, props.row.instance.agentId)}
      >
        <span class="atp-tab-avatar">
          <AgentAvatar seed={props.row.family.seed} hue={props.row.family.hue} motion="idle" />
          <Show when={props.row.thread.state !== "settled"}>
            <StateMark state={props.row.thread.state} />
          </Show>
        </span>
        <span class="atp-tab-title">{props.row.thread.title}</span>
        <Show when={copy()}>{(label) => <span class="atp-tab-copy">{label()}</span>}</Show>
      </button>
      <button
        type="button"
        class="atp-tab-close"
        aria-label={`Close ${props.row.thread.title}`}
        onClick={props.onClose}
      >
        ×
      </button>
    </span>
  );
}

/** Tabs as in a browser: any thread of any agent or copy, in the order the user opened them. */
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
                onClose={() => setOpen(opened().filter((other) => other !== id))}
              />
            )}
          </Show>
        )}
      </For>
    </span>
  );
}

/** The chosen direction: status lanes in the sidebar and open tabs from anywhere on top. */
export function LanesWithOpenTabsVariant(props: { agents: "list" | "grid" }) {
  return (
    <SidebarPrototypeShell header={(selection) => <OpenTabsHeader selection={selection} />}>
      {(selection) => (
        <>
          <StatusLanes selection={selection} />
          <AgentsSection selection={selection} layout={props.agents} />
        </>
      )}
    </SidebarPrototypeShell>
  );
}
