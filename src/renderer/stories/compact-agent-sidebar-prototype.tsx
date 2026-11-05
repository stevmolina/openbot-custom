/**
 * Prototype: a chat-style agent sidebar that also holds the page rail. Each variant renders the real
 * app, hides its page rail and sidebar content, and puts only its own sidebar in their place. A click
 * on a row opens the real chat; a page button clicks the real rail button, so the real page opens.
 */

import { ProviderLogo } from "@openbot/brand";
import {
  CalendarClock,
  ChartArea,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleQuestionMark,
  DropdownMenu,
  Ellipsis,
  ListChecks,
  MessageCircle,
  PanelLeft,
  Plus,
  Search,
  ServerGradientLogo,
  Settings,
  Store,
  Tooltip,
  Waypoints,
  Workflow,
} from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { Dynamic, type JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import {
  PROTOTYPE_ACCOUNTS,
  PROTOTYPE_AGENT_BY_ID,
  PROTOTYPE_AGENTS,
  PROTOTYPE_OPTIONS,
  PROTOTYPE_PROVIDERS,
  type PrototypeAccountId,
  type PrototypeAgent,
  type PrototypeProvider,
} from "./compact-agent-sidebar-fixtures";
import { AppSlot, createAppDom, PrototypeApp } from "./prototype-support";
import "./CompactAgentSidebarPrototype.css";

type PageId = "workflows" | "tasks" | "usage" | "routines" | "schedule" | "marketplace" | "help" | "settings";

interface Page {
  id: PageId;
  label: string;
  icon: typeof Waypoints;
}

/** Every page of the real rail and its More menu, in rail order. */
const PAGES: Record<PageId, Page> = {
  workflows: { id: "workflows", label: "Workflows", icon: Waypoints },
  tasks: { id: "tasks", label: "Tasks", icon: ListChecks },
  usage: { id: "usage", label: "Usage", icon: ChartArea },
  routines: { id: "routines", label: "Routines", icon: Workflow },
  schedule: { id: "schedule", label: "Schedule", icon: CalendarClock },
  marketplace: { id: "marketplace", label: "Marketplace", icon: Store },
  help: { id: "help", label: "Help", icon: CircleQuestionMark },
  settings: { id: "settings", label: "Settings", icon: Settings },
};

const pages = (...ids: PageId[]) => ids.map((id) => PAGES[id]);

/** Clicks the real sidebar row of an agent, so the real chat opens. */
function openRealAgent(root: HTMLElement, name: string): boolean {
  const rows = root.querySelectorAll<HTMLButtonElement>("aside.sidebar nav.agent-list button");
  const row = [...rows].find((button) => {
    const label = button.getAttribute("aria-label") ?? "";
    return label === name || label.startsWith(`${name},`) || label.startsWith(`${name}.`);
  });
  row?.click();
  return row !== undefined;
}

/** The real app, the active agent and account, and the actions that the variants share. */
function createPrototypeShell(collapsed: boolean) {
  const app = createAppDom();
  const first = PROTOTYPE_AGENTS[0];
  const [active, setActive] = createSignal(first?.id ?? "");
  const [account, setAccount] = createSignal<PrototypeAccountId>("personal");
  const [isCollapsed, setCollapsed] = createSignal(collapsed);
  const [page, setPage] = createSignal<PageId | null>(null);
  const open = (id: string) => {
    const agent = PROTOTYPE_AGENT_BY_ID.get(id);
    const root = app.dom.root;
    if (!agent || !root) return;
    // A page hides the chat list, so the Agents rail button comes back to it first.
    root.querySelector<HTMLButtonElement>('nav.window-rail > :not(.cas-sidebar) button[aria-label="Agents"]')?.click();
    // The chat list comes back after the Agents page draws, so the row is tried until it shows.
    const started = performance.now();
    const tryOpen = () => {
      if (!openRealAgent(root, agent.name) && performance.now() - started < 3000) requestAnimationFrame(tryOpen);
    };
    tryOpen();
    setActive(id);
    setPage(null);
  };
  onSettled(() => {
    const root = app.dom.root;
    if (!root || !first) return;
    // The app restores its last chat after it loads, so the first agent opens until its tab is the selected one.
    const observer = new MutationObserver(() => {
      if (
        root.querySelector('.conversation-header [role="tab"][aria-selected="true"]')?.textContent?.includes(first.name)
      ) {
        observer.disconnect();
        return;
      }
      openRealAgent(root, first.name);
    });
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  });
  const search = () => app.dom.root?.querySelector<HTMLButtonElement>(".sidebar-search-wrap button")?.click();
  /** Opens the real page through its rail button, when the rail has one. */
  const openPage = (id: PageId) => {
    const button = app.dom.root?.querySelector<HTMLButtonElement>(
      `nav.window-rail > :not(.cas-sidebar) button[aria-label="${PAGES[id].label}"]`,
    );
    button?.click();
    setPage(id);
  };
  return {
    app,
    active: () => (page() ? "" : active()),
    lastAgent: active,
    page,
    open,
    search,
    openPage,
    account,
    setAccount,
    collapsed: isCollapsed,
    toggle: () => setCollapsed((value) => !value),
  };
}

type Shell = ReturnType<typeof createPrototypeShell>;

function Avatar(props: { agent: PrototypeAgent }) {
  return (
    <AgentAvatar
      agent={{ avatarSeed: props.agent.id, avatarHue: props.agent.hue, avatarUrl: null }}
      motion="idle"
      mood={props.agent.state ?? "idle"}
    />
  );
}

const detail = (agent: PrototypeAgent) => (agent.state === "waiting" ? agent.waitReason : agent.preview);

/** One agent: big face, name, and the last message. */
function ChatRow(props: { agent: PrototypeAgent; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      class={["cas-row", { "cas-row-active": props.active }]}
      aria-current={props.active ? "page" : undefined}
      onClick={() => props.onOpen()}
    >
      <span class="cas-row-avatar">
        <Avatar agent={props.agent} />
      </span>
      <span class="cas-row-copy">
        <strong>{props.agent.name}</strong>
        <span class={["cas-row-preview", { "cas-row-preview-wait": props.agent.state === "waiting" }]}>
          {detail(props.agent)}
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

function ChatRows(props: { shell: Shell }) {
  return (
    <For each={PROTOTYPE_AGENTS}>
      {(agent) => (
        <ChatRow agent={agent} active={props.shell.active() === agent.id} onOpen={() => props.shell.open(agent.id)} />
      )}
    </For>
  );
}

/** A name that shows on hover and focus, at the right of a dock button. */
function Tip(props: { title: string; detail?: string | undefined; children: JSX.Element }) {
  return (
    <Tooltip.Root placement="right" openDelay={150} gutter={10}>
      <Tooltip.Trigger as="span" class="cas-tip-trigger">
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="cas-tip">
          <strong>{props.title}</strong>
          <Show when={props.detail}>
            <span>{props.detail}</span>
          </Show>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function IconButton(props: {
  label: string;
  current?: boolean;
  class?: string;
  onClick?: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={["cas-icon-button", props.class, { "cas-icon-button-current": props.current }]}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  );
}

function RoundButton(props: { label: string; onClick?: () => void; children: JSX.Element }) {
  return (
    <button type="button" class="cas-round" aria-label={props.label} onClick={() => props.onClick?.()}>
      {props.children}
    </button>
  );
}

function PageIcon(props: { page: Page }) {
  return <Dynamic component={props.page.icon} aria-hidden="true" />;
}

/** The More menu: the pages that have no button of their own. */
function MoreMenu(props: {
  shell: Shell;
  pages: Page[];
  placement: "top-end" | "right-end" | "bottom-start";
  class?: string;
  label?: string;
}) {
  const current = () => props.pages.some((page) => page.id === props.shell.page());
  return (
    <DropdownMenu.Root placement={props.placement} gutter={8}>
      <DropdownMenu.Trigger
        class={["cas-icon-button", props.class, { "cas-icon-button-current": current() }]}
        aria-label="More pages"
      >
        <Ellipsis aria-hidden="true" />
        <Show when={props.label}>
          <span class="cas-shortcut-label" aria-hidden="true">
            {props.label}
          </span>
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu cas-menu" aria-label="More pages">
          <For each={props.pages}>
            {(page) => (
              <DropdownMenu.Item onSelect={() => props.shell.openPage(page.id)}>
                <Dynamic component={page.icon} class="agent-context-icon size-4" aria-hidden="true" />
                <span>{page.label}</span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const accountById = (id: PrototypeAccountId) =>
  PROTOTYPE_ACCOUNTS.find((account) => account.id === id) ?? PROTOTYPE_ACCOUNTS[0];

/** The menu of the account switch: both accounts, Settings, and a way to add one. */
function AccountMenuContent(props: { shell: Shell }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content class="agent-context-menu cas-menu cas-account-menu" aria-label="Accounts">
        <For each={PROTOTYPE_ACCOUNTS}>
          {(account) => (
            <DropdownMenu.Item onSelect={() => props.shell.setAccount(account.id)}>
              <ServerGradientLogo seed={account.seed} class="cas-account-logo-small" />
              <span class="cas-account-menu-copy">
                <span>{account.name}</span>
                <span class="cas-account-menu-detail">
                  {account.server} · {account.detail}
                </span>
              </span>
              <Show when={account.id === props.shell.account()}>
                <Check class="agent-context-icon size-4 cas-account-check" aria-hidden="true" />
              </Show>
            </DropdownMenu.Item>
          )}
        </For>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => props.shell.openPage("settings")}>
          <Settings class="agent-context-icon size-4" aria-hidden="true" />
          <span>Settings</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item>
          <Plus class="agent-context-icon size-4" aria-hidden="true" />
          <span>Add an account</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

/**
 * The account switch. `stack` shows the current account with the other one behind it; `card` adds the
 * name and server. Both open the account menu.
 */
function AccountSwitch(props: { shell: Shell; look: "stack" | "card"; placement: "top-start" | "right-end" }) {
  const current = () => accountById(props.shell.account());
  const other = () => PROTOTYPE_ACCOUNTS.find((account) => account.id !== props.shell.account());
  return (
    <DropdownMenu.Root placement={props.placement} gutter={8}>
      <DropdownMenu.Trigger
        class={["cas-account", { "cas-account-card": props.look === "card" }]}
        aria-label={props.look === "stack" ? `${current().name} ${current().server}, switch account` : undefined}
      >
        <span class="cas-account-stack">
          <Show when={other()}>
            {(account) => <ServerGradientLogo seed={account().seed} class="cas-account-logo cas-account-logo-back" />}
          </Show>
          <ServerGradientLogo seed={current().seed} class="cas-account-logo cas-account-logo-front" />
        </span>
        <Show when={props.look === "card"}>
          <span class="cas-account-copy">
            <strong>{current().name} </strong>
            <span>{current().server}</span>
            <span class="sr-only">, switch account</span>
          </span>
          <ChevronsUpDown class="cas-account-chevron" aria-hidden="true" />
        </Show>
      </DropdownMenu.Trigger>
      <AccountMenuContent shell={props.shell} />
    </DropdownMenu.Root>
  );
}

/** Both accounts side by side: one click switches. */
function AccountPair(props: { shell: Shell }) {
  return (
    <fieldset class="cas-fieldset cas-account-pair" aria-label="Accounts">
      <For each={PROTOTYPE_ACCOUNTS}>
        {(account) => (
          <button
            type="button"
            class={["cas-account-pair-button", { "cas-account-pair-current": account.id === props.shell.account() }]}
            aria-label={`${account.name}, ${account.server}`}
            aria-pressed={account.id === props.shell.account() ? "true" : "false"}
            title={`${account.name} · ${account.server}`}
            onClick={() => props.shell.setAccount(account.id)}
          >
            <ServerGradientLogo seed={account.seed} class="cas-account-logo" />
          </button>
        )}
      </For>
    </fieldset>
  );
}

/** Two tracks in a 32px box, as the page rail draws them. */
const RING = { size: 32, stroke: 2.25, spacing: 4.5 };

/** Starts with the words that the button shows, so a voice command can name it. */
function usageLabel(provider: PrototypeProvider) {
  const lowest = Math.min(...provider.windows.map((window) => window.remaining));
  const windows = provider.windows.map((window) => `${window.label} ${window.remaining}%`).join(", ");
  return `${provider.name} ${lowest}% left. ${windows}`;
}

/** One provider's plan limits as two rings around its logo. A click opens the usage page. */
function UsageRing(props: { provider: PrototypeProvider; onOpen: () => void; withText?: boolean | undefined }) {
  const outer = (RING.size - RING.stroke) / 2;
  const lowest = () => Math.min(...props.provider.windows.map((window) => window.remaining));
  return (
    <button
      type="button"
      class={["cas-usage", { "cas-usage-text": props.withText }]}
      aria-label={props.withText ? undefined : usageLabel(props.provider)}
      title={usageLabel(props.provider)}
      onClick={() => props.onOpen()}
    >
      <span class="cas-usage-ring-box">
        <svg class="cas-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
          <For each={props.provider.windows}>
            {(window, index) => (
              <g>
                <circle
                  class="cas-usage-track"
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={outer - index() * RING.spacing}
                  stroke-width={RING.stroke}
                />
                <circle
                  class="cas-usage-arc"
                  data-tone={window.tone}
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={outer - index() * RING.spacing}
                  stroke-width={RING.stroke}
                  stroke-linecap="round"
                  pathLength={100}
                  stroke-dasharray={`${window.remaining} 100`}
                />
              </g>
            )}
          </For>
        </svg>
        <ProviderLogo provider={props.provider.provider} class="cas-usage-logo" />
      </span>
      <Show when={props.withText}>
        <span class="cas-usage-copy">
          <span class="cas-usage-name">{props.provider.name} </span>
          <span class={["cas-usage-left", { "cas-usage-low": lowest() < 25 }]}>{lowest()}% left</span>
          <span class="sr-only">
            . {props.provider.windows.map((window) => `${window.label} ${window.remaining}%`).join(", ")}
          </span>
        </span>
      </Show>
    </button>
  );
}

function UsageRings(props: { shell: Shell; withText?: boolean; class?: string }) {
  return (
    <fieldset class={["cas-fieldset cas-usage-group", props.class]} aria-label="AI providers">
      <For each={PROTOTYPE_PROVIDERS}>
        {(provider) => (
          <UsageRing provider={provider} withText={props.withText} onOpen={() => props.shell.openPage("usage")} />
        )}
      </For>
    </fieldset>
  );
}

function TopBar(props: { shell: Shell }) {
  return (
    <div class="cas-top window-drag">
      <IconButton label="Collapse sidebar" onClick={props.shell.toggle}>
        <PanelLeft aria-hidden="true" />
      </IconButton>
      <span class="cas-spacer" />
      <RoundButton label="Search" onClick={props.shell.search}>
        <Search aria-hidden="true" />
      </RoundButton>
      <RoundButton label="New agent">
        <Plus aria-hidden="true" />
      </RoundButton>
    </div>
  );
}

/** A page button in a dock, with its name on hover. */
function DockPage(props: { shell: Shell; page: Page }) {
  return (
    <Tip title={props.page.label}>
      <IconButton
        label={props.page.label}
        class="cas-dock-button"
        current={props.shell.page() === props.page.id}
        onClick={() => props.shell.openPage(props.page.id)}
      >
        <PageIcon page={props.page} />
      </IconButton>
    </Tip>
  );
}

/** The collapsed sidebar: faces only, with each variant's pages and accounts. */
function Dock(props: { shell: Shell; top?: JSX.Element; bottom: JSX.Element }) {
  return (
    <div class="cas-sidebar cas-dock">
      <div class="cas-dock-top window-drag">
        <Tip title="Expand sidebar">
          <IconButton label="Expand sidebar" class="cas-dock-button" onClick={props.shell.toggle}>
            <PanelLeft aria-hidden="true" />
          </IconButton>
        </Tip>
        <Tip title="Search">
          <RoundButton label="Search" onClick={props.shell.search}>
            <Search aria-hidden="true" />
          </RoundButton>
        </Tip>
        <Tip title="New agent">
          <RoundButton label="New agent">
            <Plus aria-hidden="true" />
          </RoundButton>
        </Tip>
        {props.top}
      </div>
      <nav class="cas-dock-list" aria-label="Chat list">
        <For each={PROTOTYPE_AGENTS}>
          {(agent) => (
            <Tip title={agent.name} detail={detail(agent)}>
              <button
                type="button"
                class={["cas-dock-face", { "cas-dock-face-active": props.shell.active() === agent.id }]}
                aria-label={`${agent.name}. ${detail(agent)}`}
                aria-current={props.shell.active() === agent.id ? "page" : undefined}
                onClick={() => props.shell.open(agent.id)}
              >
                <Avatar agent={agent} />
                <Show when={agent.unread}>
                  <span class="cas-unread cas-dock-unread" />
                </Show>
              </button>
            </Tip>
          )}
        </For>
      </nav>
      <div class="cas-dock-bottom">{props.bottom}</div>
    </div>
  );
}

function PrototypeFrame(props: { shell: Shell; children: JSX.Element }) {
  return (
    <div class={["cas-proto", { "cas-collapsed": props.shell.collapsed() }]} ref={props.shell.app.attach}>
      <PrototypeApp options={PROTOTYPE_OPTIONS} />
      <AppSlot app={props.shell.app} slot="rail">
        {props.children}
      </AppSlot>
    </div>
  );
}

/**
 * A1. The pill of the reference holds Chats and the two main pages; More holds the rest. The provider
 * rings sit above the pill with how much is left.
 */
export function PillVariant(props: { collapsed?: boolean }) {
  const shell = createPrototypeShell(props.collapsed === true);
  const more = pages("usage", "routines", "schedule", "marketplace", "help", "settings");
  const pill = (vertical: boolean) => (
    <div class={["cas-pill", { "cas-pill-vertical": vertical }]}>
      <AccountSwitch shell={shell} look="stack" placement={vertical ? "right-end" : "top-start"} />
      <div class="cas-pill-pages">
        <IconButton
          label="Chats"
          class="cas-pill-button"
          current={shell.page() === null}
          onClick={() => shell.open(shell.lastAgent())}
        >
          <MessageCircle aria-hidden="true" />
        </IconButton>
        <For each={pages("workflows", "tasks")}>
          {(page) => (
            <IconButton
              label={page.label}
              class="cas-pill-button"
              current={shell.page() === page.id}
              onClick={() => shell.openPage(page.id)}
            >
              <PageIcon page={page} />
            </IconButton>
          )}
        </For>
        <MoreMenu shell={shell} pages={more} placement={vertical ? "right-end" : "top-end"} class="cas-pill-button" />
      </div>
    </div>
  );
  return (
    <PrototypeFrame shell={shell}>
      <Show
        when={!shell.collapsed()}
        fallback={
          <Dock
            shell={shell}
            bottom={
              <>
                <UsageRings shell={shell} class="cas-usage-column" />
                {pill(true)}
              </>
            }
          />
        }
      >
        <div class="cas-sidebar">
          <TopBar shell={shell} />
          <nav class="cas-list" aria-label="Chat list">
            <ChatRows shell={shell} />
          </nav>
          <UsageRings shell={shell} withText class="cas-usage-row" />
          {pill(false)}
        </div>
      </Show>
    </PrototypeFrame>
  );
}

/** A2. A row of labelled shortcuts under the top bar; accounts, provider rings and Settings at the bottom. */
export function ShortcutsVariant(props: { collapsed?: boolean }) {
  const shell = createPrototypeShell(props.collapsed === true);
  const shortcuts = pages("workflows", "tasks", "usage");
  const more = pages("routines", "schedule", "marketplace", "help");
  return (
    <PrototypeFrame shell={shell}>
      <Show
        when={!shell.collapsed()}
        fallback={
          <Dock
            shell={shell}
            top={
              <div class="cas-dock-pages">
                <For each={shortcuts}>{(page) => <DockPage shell={shell} page={page} />}</For>
                <Tip title="More">
                  <MoreMenu shell={shell} pages={more} placement="right-end" class="cas-dock-button" />
                </Tip>
              </div>
            }
            bottom={
              <>
                <UsageRings shell={shell} class="cas-usage-column" />
                <DockPage shell={shell} page={PAGES.settings} />
                <AccountSwitch shell={shell} look="stack" placement="right-end" />
              </>
            }
          />
        }
      >
        <div class="cas-sidebar">
          <TopBar shell={shell} />
          <fieldset class="cas-fieldset cas-shortcuts" aria-label="Pages">
            <For each={shortcuts}>
              {(page) => (
                <IconButton
                  label={page.label}
                  class="cas-shortcut"
                  current={shell.page() === page.id}
                  onClick={() => shell.openPage(page.id)}
                >
                  <PageIcon page={page} />
                  <span class="cas-shortcut-label" aria-hidden="true">
                    {page.label}
                  </span>
                </IconButton>
              )}
            </For>
            <MoreMenu shell={shell} pages={more} placement="bottom-start" class="cas-shortcut" label="More" />
          </fieldset>
          <nav class="cas-list" aria-label="Chat list">
            <ChatRows shell={shell} />
          </nav>
          <div class="cas-bottom-bar">
            <AccountPair shell={shell} />
            <span class="cas-spacer" />
            <UsageRings shell={shell} />
            <IconButton
              label="Settings"
              current={shell.page() === "settings"}
              onClick={() => shell.openPage("settings")}
            >
              <Settings aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </Show>
    </PrototypeFrame>
  );
}

/** A3. Three pages as rows above the chats, with "See more" for the rest; one account card at the bottom. */
export function SeeMoreVariant(props: { collapsed?: boolean; expanded?: boolean }) {
  const shell = createPrototypeShell(props.collapsed === true);
  const [expanded, setExpanded] = createSignal(props.expanded === true);
  const main = pages("workflows", "tasks", "usage");
  const rest = pages("routines", "schedule", "marketplace", "help", "settings");
  const row = (page: Page) => (
    <button
      type="button"
      class={["cas-page-row", { "cas-page-row-current": shell.page() === page.id }]}
      aria-current={shell.page() === page.id ? "page" : undefined}
      onClick={() => shell.openPage(page.id)}
    >
      <PageIcon page={page} />
      <span>{page.label}</span>
    </button>
  );
  return (
    <PrototypeFrame shell={shell}>
      <Show
        when={!shell.collapsed()}
        fallback={
          <Dock
            shell={shell}
            bottom={
              <>
                <For each={main}>{(page) => <DockPage shell={shell} page={page} />}</For>
                <Tip title="See more">
                  <MoreMenu shell={shell} pages={rest} placement="right-end" class="cas-dock-button" />
                </Tip>
                <span class="cas-dock-rule" />
                <UsageRings shell={shell} class="cas-usage-column" />
                <AccountSwitch shell={shell} look="stack" placement="right-end" />
              </>
            }
          />
        }
      >
        <div class="cas-sidebar">
          <TopBar shell={shell} />
          <nav class="cas-list" aria-label="Pages and chats">
            <section class="cas-group" aria-label="Pages">
              <For each={main}>{(page) => row(page)}</For>
              <Show when={expanded()}>
                <For each={rest}>{(page) => row(page)}</For>
              </Show>
              <button
                type="button"
                class="cas-page-row cas-see-more"
                aria-expanded={expanded() ? "true" : "false"}
                onClick={() => setExpanded((value) => !value)}
              >
                <ChevronDown aria-hidden="true" class="cas-see-more-chevron" />
                <span>{expanded() ? "See less" : "See more"}</span>
              </button>
            </section>
            <section class="cas-group" aria-label="Chats">
              <h2 class="cas-group-title">Chats</h2>
              <ChatRows shell={shell} />
            </section>
          </nav>
          <div class="cas-bottom-bar">
            <AccountSwitch shell={shell} look="card" placement="top-start" />
            <UsageRings shell={shell} />
          </div>
        </div>
      </Show>
    </PrototypeFrame>
  );
}
