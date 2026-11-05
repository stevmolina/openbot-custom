/**
 * Prototype: a chat-style agent sidebar, after a reference screenshot. Each variant renders the real
 * app and puts only its own sidebar into it. A click on a row opens the real chat of that agent.
 */

import { ChevronDown, History, MessageCircle, PanelLeft, Plug, Plus, Search, Tooltip } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { type JSX, Portal } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import {
  PROTOTYPE_AGENT_BY_ID,
  PROTOTYPE_AGENTS,
  PROTOTYPE_CONNECTIONS,
  PROTOTYPE_HISTORY,
  PROTOTYPE_OPTIONS,
  type PrototypeAgent,
} from "./compact-agent-sidebar-fixtures";
import { type AppDom, AppSlot, createAppDom, PrototypeApp } from "./prototype-support";
import "./CompactAgentSidebarPrototype.css";

type Tab = "chats" | "history" | "connections";

const TABS: { id: Tab; label: string; icon: () => JSX.Element }[] = [
  { id: "chats", label: "Chats", icon: () => <MessageCircle aria-hidden="true" /> },
  { id: "history", label: "History", icon: () => <History aria-hidden="true" /> },
  { id: "connections", label: "Connections", icon: () => <Plug aria-hidden="true" /> },
];

/** Clicks the real sidebar row of an agent, so the real chat opens. */
function openRealAgent(root: HTMLElement, name: string): boolean {
  const rows = root.querySelectorAll<HTMLButtonElement>("aside.sidebar nav.agent-list button.agent-row");
  const row = [...rows].find((button) => button.querySelector("strong")?.textContent?.trim() === name);
  row?.click();
  return row !== undefined;
}

/** The real app, the active agent, and a way to open an agent's chat. */
function createPrototypeShell() {
  const app = createAppDom();
  const first = PROTOTYPE_AGENTS[0];
  const [active, setActive] = createSignal(first?.id ?? "");
  const open = (id: string) => {
    const agent = PROTOTYPE_AGENT_BY_ID.get(id);
    const root = app.dom.root;
    if (agent && root) openRealAgent(root, agent.name);
    setActive(id);
  };
  onSettled(() => {
    const root = app.dom.root;
    if (!root || !first) return;
    const observer = new MutationObserver(() => {
      if (openRealAgent(root, first.name)) observer.disconnect();
    });
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  });
  const search = () => app.dom.root?.querySelector<HTMLButtonElement>(".sidebar-search-wrap button")?.click();
  return { app, active, open, search };
}

function mood(agent: PrototypeAgent) {
  return agent.state ?? "idle";
}

function Avatar(props: { agent: PrototypeAgent }) {
  return (
    <AgentAvatar
      agent={{ avatarSeed: props.agent.id, avatarHue: props.agent.hue, avatarUrl: null }}
      motion="idle"
      mood={mood(props.agent)}
    />
  );
}

/** One agent: big face, name, and the last message. */
function ChatRow(props: { agent: PrototypeAgent; active: boolean; onOpen: () => void; showTime?: boolean }) {
  return (
    <button
      type="button"
      class={["cas-row", { "cas-row-active": props.active }]}
      aria-pressed={props.active ? "true" : "false"}
      onClick={() => props.onOpen()}
    >
      <span class="cas-row-avatar">
        <Avatar agent={props.agent} />
      </span>
      <span class="cas-row-copy">
        <span class="cas-row-top">
          <strong>{props.agent.name}</strong>
          <Show when={props.showTime}>
            <span class="cas-row-time">{props.agent.time}</span>
          </Show>
        </span>
        <span class={["cas-row-preview", { "cas-row-preview-wait": props.agent.state === "waiting" }]}>
          {props.agent.state === "waiting" ? props.agent.waitReason : props.agent.preview}
        </span>
      </span>
      <Show when={props.agent.unread}>
        <span class="cas-unread">
          <span class="sr-only">Unread</span>
        </span>
      </Show>
    </button>
  );
}

function HistoryPanel(props: { onOpen: (id: string) => void }) {
  return (
    <div class="cas-panel-list">
      <For each={PROTOTYPE_HISTORY}>
        {(group) => (
          <section class="cas-group" aria-label={group.day}>
            <h2 class="cas-group-title">{group.day}</h2>
            <For each={group.items}>
              {(item) => {
                const agent = () => PROTOTYPE_AGENT_BY_ID.get(item.agentId);
                return (
                  <Show when={agent()}>
                    {(found) => (
                      <button type="button" class="cas-history-row" onClick={() => props.onOpen(found().id)}>
                        <span class="cas-history-avatar">
                          <Avatar agent={found()} />
                        </span>
                        <span class="cas-row-copy">
                          <strong>{item.title}</strong>
                          <span class="cas-row-preview">
                            {found().name} · {item.time}
                          </span>
                        </span>
                      </button>
                    )}
                  </Show>
                );
              }}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}

function ConnectionsPanel() {
  return (
    <div class="cas-panel-list">
      <h2 class="cas-group-title">Connections</h2>
      <For each={PROTOTYPE_CONNECTIONS}>
        {(item) => (
          <button type="button" class="cas-history-row">
            <span class="cas-tool-tile" aria-hidden="true">
              {item.name.slice(0, 1)}
            </span>
            <span class="cas-row-copy">
              <strong>{item.name}</strong>
              <span class="cas-row-preview">{item.detail}</span>
            </span>
            <span class={["cas-tool-state", { "cas-tool-state-on": item.connected }]}>
              {item.connected ? "On" : "Connect"}
            </span>
          </button>
        )}
      </For>
    </div>
  );
}

/** The user's face and the three views, in one floating pill. */
function TabPill(props: { tab: Tab; onTab: (tab: Tab) => void; vertical?: boolean }) {
  return (
    <div class={["cas-pill", { "cas-pill-vertical": props.vertical }]}>
      <button type="button" class="cas-me" aria-label="Account and servers: Steven, Local">
        S
      </button>
      <div class="cas-tabs" role="tablist" aria-label="Sidebar views">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              class="cas-tab"
              aria-selected={props.tab === tab.id ? "true" : "false"}
              aria-label={tab.label}
              title={tab.label}
              onClick={() => props.onTab(tab.id)}
            >
              {tab.icon()}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function RoundButton(props: { label: string; onClick?: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      class="cas-round"
      aria-label={props.label}
      title={props.label}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  );
}

function PrototypeFrame(props: { app: AppDom; class: string; children: JSX.Element }) {
  return (
    <div class={["cas-proto", props.class]} ref={props.app.attach}>
      <PrototypeApp options={PROTOTYPE_OPTIONS} />
      <AppSlot app={props.app} slot="sidebar">
        {props.children}
      </AppSlot>
    </div>
  );
}

/** A. The reference, close to as is: one list by last message, and the views in a pill at the bottom. */
export function ChatListVariant() {
  const shell = createPrototypeShell();
  const [tab, setTab] = createSignal<Tab>("chats");
  return (
    <PrototypeFrame app={shell.app} class="cas-variant-list">
      <div class="cas-sidebar">
        <div class="cas-top window-drag">
          <button type="button" class="cas-icon-button" aria-label="Hide sidebar" title="Hide sidebar">
            <PanelLeft aria-hidden="true" />
          </button>
          <span class="cas-spacer" />
          <RoundButton label="Search" onClick={shell.search}>
            <Search aria-hidden="true" />
          </RoundButton>
          <RoundButton label="New agent">
            <Plus aria-hidden="true" />
          </RoundButton>
        </div>
        <nav class="cas-list" aria-label="Chat list">
          <Show when={tab() === "chats"}>
            <For each={PROTOTYPE_AGENTS}>
              {(agent) => (
                <ChatRow agent={agent} active={shell.active() === agent.id} onOpen={() => shell.open(agent.id)} />
              )}
            </For>
          </Show>
          <Show when={tab() === "history"}>
            <HistoryPanel onOpen={shell.open} />
          </Show>
          <Show when={tab() === "connections"}>
            <ConnectionsPanel />
          </Show>
        </nav>
        <TabPill tab={tab()} onTab={setTab} />
      </div>
    </PrototypeFrame>
  );
}

/** B. The real top bar, search and page rail stay. The rows become chat rows, grouped by what they need. */
export function LanesVariant() {
  const shell = createPrototypeShell();
  const lanes = [
    { id: "waiting", title: "Needs you", agents: PROTOTYPE_AGENTS.filter((agent) => agent.state === "waiting") },
    { id: "working", title: "Working", agents: PROTOTYPE_AGENTS.filter((agent) => agent.state === "working") },
    { id: "agents", title: "Agents", agents: PROTOTYPE_AGENTS.filter((agent) => !agent.state) },
  ];
  const [closed, setClosed] = createSignal<string[]>([]);
  const toggle = (id: string) =>
    setClosed((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  return (
    <PrototypeFrame app={shell.app} class="cas-variant-lanes">
      <nav class="cas-sidebar cas-list" aria-label="Chat list">
        <For each={lanes}>
          {(lane) => (
            <section class="cas-group" aria-label={lane.title}>
              <button
                type="button"
                class="cas-lane-header"
                aria-expanded={closed().includes(lane.id) ? "false" : "true"}
                onClick={() => toggle(lane.id)}
              >
                <span class={["cas-lane-title", { "cas-lane-title-wait": lane.id === "waiting" }]}>{lane.title}</span>
                <span class="cas-lane-count">{lane.agents.length}</span>
                <ChevronDown aria-hidden="true" class="cas-lane-chevron" />
              </button>
              <Show when={!closed().includes(lane.id)}>
                <For each={lane.agents}>
                  {(agent) => (
                    <ChatRow
                      agent={agent}
                      active={shell.active() === agent.id}
                      onOpen={() => shell.open(agent.id)}
                      showTime
                    />
                  )}
                </For>
              </Show>
            </section>
          )}
        </For>
      </nav>
    </PrototypeFrame>
  );
}

/** One face in the dock. The name and last message show on hover and focus. */
function DockFace(props: { agent: PrototypeAgent; active: boolean; onOpen: () => void }) {
  const detail = () => (props.agent.state === "waiting" ? props.agent.waitReason : props.agent.preview);
  return (
    <Tooltip.Root placement="right" openDelay={150}>
      <Tooltip.Trigger
        as="button"
        type="button"
        class={["cas-dock-face", { "cas-dock-face-active": props.active }]}
        aria-label={`${props.agent.name}. ${detail()}`}
        aria-pressed={props.active ? "true" : "false"}
        onClick={() => props.onOpen()}
      >
        <Avatar agent={props.agent} />
        <Show when={props.agent.unread}>
          <span class="cas-unread cas-dock-unread" />
        </Show>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="cas-tip">
          <strong>{props.agent.name}</strong>
          <span>{detail()}</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** C. Faces only. The name and last message show on hover; History and Connections open beside the dock. */
export function DockVariant() {
  const shell = createPrototypeShell();
  const [tab, setTab] = createSignal<Tab>("chats");
  const openFromPanel = (id: string) => {
    shell.open(id);
    setTab("chats");
  };
  return (
    <PrototypeFrame app={shell.app} class="cas-variant-dock">
      <div class="cas-sidebar">
        <div class="cas-dock-top window-drag">
          <RoundButton label="Search" onClick={shell.search}>
            <Search aria-hidden="true" />
          </RoundButton>
          <RoundButton label="New agent">
            <Plus aria-hidden="true" />
          </RoundButton>
        </div>
        <nav class="cas-dock-list" aria-label="Agents">
          <For each={PROTOTYPE_AGENTS}>
            {(agent) => (
              <DockFace agent={agent} active={shell.active() === agent.id} onOpen={() => shell.open(agent.id)} />
            )}
          </For>
        </nav>
        <TabPill tab={tab()} onTab={setTab} vertical />
      </div>
      <Show when={tab() !== "chats"}>
        <Portal mount={document.body}>
          <div class="cas-flyout" role="dialog" aria-label={tab() === "history" ? "History" : "Connections"}>
            <Show when={tab() === "history"} fallback={<ConnectionsPanel />}>
              <HistoryPanel onOpen={openFromPanel} />
            </Show>
          </div>
        </Portal>
      </Show>
    </PrototypeFrame>
  );
}
