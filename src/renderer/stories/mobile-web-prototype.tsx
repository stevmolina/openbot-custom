/**
 * Prototype: the phone layout of the web client with many agents in folders. Each variant renders the
 * real `WebWorkspace` over the mock host and changes only the phone chrome and the folder layout.
 * The folder and tab actions call the real controls (the dock toggles, the tab bar, the pill), so the
 * screens behave as the app does.
 */

import {
  AVATAR_HUES,
  type ClientAgentSummary,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { ListChecks, MessageCircle, Search, Settings, Toaster, Waypoints } from "@openbot/ui";
import { Dynamic, Portal } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
import type { WebRuntimeFactory } from "../src/features/web-client/web-client-context";
import { mockAccountCatalogFetch } from "../src/preview/mock-account-catalog";
import { createMockOpenBot } from "../src/preview/mock-openbot";
import { mockWebRuntimeFor } from "../src/preview/mock-web-runtime";
import "../src/features/web-client/web-client.css";
import "./MobileWebPrototype.css";

interface ProtoFolder {
  id: string;
  name: string;
  agents: ReadonlyArray<readonly [name: string, preview: string]>;
}

/** The folders of the Personal VPS, with sample agents. */
export const PROTO_FOLDERS: ReadonlyArray<ProtoFolder> = [
  {
    id: "dev",
    name: "Development & Projects",
    agents: [
      ["Pokebots Dev", "The mobile build is green. Two reviews are open."],
      ["Rooms", "Invite links now expire after seven days."],
      ["Brain MCP", "Search now returns the page date with each claim."],
    ],
  },
  {
    id: "personal",
    name: "Personal & Everyday",
    agents: [
      ["Inbox Zero", "Twelve mails need a reply today."],
      ["Calendar", "You have three calls tomorrow before noon."],
      ["Finance", "The card statement is ready to check."],
      ["Travel", "Your flight to Lima leaves at 07:40."],
      ["Health", "Your next check-up is on Friday."],
    ],
  },
  {
    id: "learning",
    name: "Learning & Research",
    agents: [
      ["Research", "Three useful sources are ready for your review."],
      ["Paper Reader", "I summarised the two new papers on agents."],
      ["Course Tutor", "Week 6 quiz is ready when you are."],
      ["Language Coach", "Today: ten minutes of Portuguese."],
      ["News Digest", "Five stories match your topics."],
      ["Deep Dive", "The report on edge runtimes is done."],
      ["Book Notes", "Chapter 4 notes are saved."],
      ["Podcast Notes", "Two episodes are summarised."],
      ["Market Scan", "Three competitors shipped this week."],
      ["Trend Watch", "Voice agents keep growing in search."],
    ],
  },
  {
    id: "brand",
    name: "Brand & Content",
    agents: [
      ["Posts", "Three LinkedIn drafts are ready."],
      ["Video Editor", "The demo cut is 28 seconds now."],
      ["Newsletter", "Issue 14 is drafted."],
      ["Designer", "Two landing options are ready."],
      ["Copywriter", "The new hero line is shorter."],
      ["SEO", "Four pages lost rank this week."],
      ["Social Listener", "Two mentions need an answer."],
      ["Thumbnails", "Six covers are rendered."],
      ["Brand Voice", "The tone guide is updated."],
    ],
  },
  {
    id: "sales",
    name: "Sales & Business",
    agents: [
      ["Sales Outbound", "The follow-up draft is ready to send."],
      ["Proposals", "The proposal is waiting for prices."],
      ["CRM Keeper", "Seven contacts were enriched."],
      ["Invoices", "Two invoices are overdue."],
      ["Partnerships", "One reply from the agency came in."],
    ],
  },
  {
    id: "total",
    name: "TotalEnergies",
    agents: [
      ["Total PM", "The sprint review is on Thursday."],
      ["Total Data", "The new dashboard loads in 2 seconds."],
      ["Total Docs", "The handover guide has 3 open points."],
      ["Total QA", "All 48 checks passed last night."],
      ["Total Ops", "The VPN certificate renews in 9 days."],
      ["Total Reports", "The weekly report is drafted."],
      ["Total Meetings", "Notes from today's call are saved."],
      ["Total Infra", "Disk use is at 61%."],
      ["Total Support", "Two tickets wait for a reply."],
    ],
  },
  {
    id: "events",
    name: "Events & Opportunities",
    agents: [
      ["Events Radar", "Two AI meetups in Lima this month."],
      ["Grants", "One deadline is next week."],
      ["Hackathons", "Registration closes on Sunday."],
      ["Speaker", "The talk outline is ready."],
    ],
  },
  {
    id: "tools",
    name: "Assistants & Tools",
    agents: [
      ["Chief", "I pulled together the latest project notes and next steps."],
      ["Computer", "The desktop is ready."],
      ["Browser", "Three tabs are open for you."],
      ["Translator", "The Spanish copy is done."],
      ["Scheduler", "Two routines ran this morning."],
      ["Files", "The Downloads folder is clean."],
    ],
  },
];

const PROVIDERS = ["codex", "claude", "grok"] as const;
const NOW = Date.parse("2026-11-12T15:20:00.000Z");

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function protoAgents(): ClientAgentSummary[] {
  let index = 0;
  return PROTO_FOLDERS.flatMap((folder) =>
    folder.agents.map(([name, preview]) => {
      const id = slug(name);
      const at = NOW - index * 47 * 60_000;
      const provider = PROVIDERS[index % PROVIDERS.length] ?? "codex";
      index += 1;
      return {
        id,
        provider,
        name,
        title: folder.name,
        description: preview,
        notifications: true,
        model: provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
        reasoningEffort: "medium",
        access: "full",
        threadId: `thread-${id}`,
        workspacePath: `/mock/OpenBot/Agents/${id}`,
        preview,
        updatedAt: new Date(at).toISOString(),
        avatarSeed: id,
        avatarHue: AVATAR_HUES[(index * 3) % AVATAR_HUES.length] ?? 245,
        avatarUrl: null,
      } satisfies ClientAgentSummary;
    }),
  );
}

function protoLayout(): SidebarLayoutSnapshot {
  return {
    revision: 1,
    sections: PROTO_FOLDERS.map((folder) => ({ id: folder.id, name: folder.name })),
    order: [...PROTO_FOLDERS.map((folder) => folder.id), SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID],
    agentAssignments: Object.fromEntries(
      PROTO_FOLDERS.flatMap((folder) => folder.agents.map(([name]) => [slug(name), folder.id] as const)),
    ),
    agentOrder: [],
  };
}

/** The mock host, named as the server in the screenshot, with the folders and agents above. */
export const protoRuntime: WebRuntimeFactory = (_accountId, events) => {
  const runtime = mockWebRuntimeFor(createMockOpenBot({ agents: protoAgents(), sidebarLayout: protoLayout() }), events);
  return {
    ...runtime,
    listHosts: async () => (await runtime.listHosts()).map((host) => ({ ...host, name: "Personal VPS" })),
  };
};

const accountFetch = mockAccountCatalogFetch();

/** The real workspace over the prototype host. */
export function ProtoWorkspace() {
  return (
    <div class="web-app">
      <Toaster />
      <WebWorkspace
        accountId="preview-account"
        accountEmail="you@example.com"
        accountName="Steven"
        accountFetch={accountFetch}
        onSessionCheck={async () => {}}
        onLogout={async () => {}}
        createRuntime={protoRuntime}
        language="system"
        onChangeLanguage={() => {}}
        appearance="dark"
        onChangeAppearance={() => {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------- helpers that call the real controls

/** Waits until the dock of the sidebar is on screen. */
function whenDock(root: HTMLElement, run: (dock: HTMLElement) => void) {
  const found = root.querySelector<HTMLElement>(".sidebar-dock");
  if (found) {
    run(found);
    return;
  }
  const observer = new MutationObserver(() => {
    const dock = root.querySelector<HTMLElement>(".sidebar-dock");
    if (!dock) return;
    observer.disconnect();
    run(dock);
  });
  observer.observe(root, { childList: true, subtree: true });
}

function folderHeads(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLButtonElement>(".sidebar-dock .sidebar-dock-head")];
}

/**
 * Opens or closes every folder of the dock with its own toggle, one per frame, so each click sees the
 * open groups that the one before it saved.
 */
function setAllFolders(root: HTMLElement, open: boolean, done?: () => void) {
  const head = folderHeads(root).find((item) => (item.getAttribute("aria-expanded") === "true") !== open);
  if (!head) {
    done?.();
    return;
  }
  head.click();
  requestAnimationFrame(() => setAllFolders(root, open, done));
}

/** The saved open groups load a moment after the dock shows, so the folders are set after that. */
function setAllFoldersSettled(root: HTMLElement, open: boolean, done?: () => void) {
  window.setTimeout(() => setAllFolders(root, open, done), 1200);
}

function clickTab(root: HTMLElement, index: number) {
  root.querySelectorAll<HTMLButtonElement>(".web-phone-tab-bar .web-phone-tab")[index]?.click();
}

function clickPill(root: HTMLElement, label: string) {
  root.querySelector<HTMLButtonElement>(`.sidebar-pill-button[aria-label="${label}"]`)?.click();
}

const TAB = { chats: 0, servers: 1, search: 2, settings: 3 } as const;

/** A search field that opens the real search. */
function SearchField(props: { root: () => HTMLElement | undefined }) {
  return (
    <button
      type="button"
      class="proto-search"
      onClick={() => {
        const root = props.root();
        if (root) clickTab(root, TAB.search);
      }}
    >
      <Search aria-hidden="true" />
      <span>Search chats</span>
    </button>
  );
}

// ---------------------------------------------------------------- A. One list

/**
 * A. One list: every folder is open in one scroll, under the large title and a search field. One tab
 * bar holds Chats, Tasks, Workflows and Settings. A tap on the server name opens the server drawer.
 */
export function OneListVariant() {
  let root: HTMLDivElement | undefined;
  const [mounts, setMounts] = createSignal<{ list: HTMLElement; frame: HTMLElement } | null>(null);
  const [tab, setTab] = createSignal(0);
  onSettled(() => {
    const element = root;
    if (!element) return;
    // The server name opens the server drawer. The real title has no handler, so the frame listens.
    element.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".sidebar-chat-large-title")) {
        clickTab(element, TAB.servers);
      }
    });
    whenDock(element, () => {
      setAllFoldersSettled(element, true);
      // The whole list scrolls now, so the small title of the top bar follows the list's scroll.
      const scroller = element.querySelector<HTMLElement>(".sidebar-chat-list");
      const barTitle = element.querySelector<HTMLElement>(".sidebar-chat-bar-title");
      scroller?.addEventListener("scroll", () => barTitle?.toggleAttribute("data-shown", scroller.scrollTop > 48));
      const list = element.querySelector<HTMLElement>(".agent-list-content");
      const frame = element.querySelector<HTMLElement>(".web-app-frame");
      if (list && frame) setMounts({ list, frame });
    });
  });
  const go = (index: number, action: () => void) => {
    setTab(index);
    action();
  };
  return (
    <div class="proto-mobile proto-a" ref={root}>
      <ProtoWorkspace />
      <Show when={mounts()}>
        {(m) => (
          <>
            <Portal mount={m().list}>
              <SearchField root={() => root} />
            </Portal>
            <Portal mount={m().frame}>
              <div class="proto-tab-fade" aria-hidden="true" />
              <nav class="proto-tab-bar" aria-label="Pages">
                <For
                  each={[
                    { label: "Chats", Icon: MessageCircle, run: () => root && clickTab(root, TAB.chats) },
                    { label: "Tasks", Icon: ListChecks, run: () => root && clickPill(root, "Tasks") },
                    { label: "Workflows", Icon: Waypoints, run: () => root && clickPill(root, "Workflows") },
                    { label: "Settings", Icon: Settings, run: () => root && clickTab(root, TAB.settings) },
                  ]}
                >
                  {(item, index) => (
                    <button
                      type="button"
                      class="proto-tab"
                      aria-current={tab() === index() ? "page" : undefined}
                      onClick={() => go(index(), item.run)}
                    >
                      <Dynamic component={item.Icon} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  )}
                </For>
              </nav>
            </Portal>
          </>
        )}
      </Show>
    </div>
  );
}

/** Today's layout with the same folders, for comparison. */
export function TodayVariant() {
  return (
    <div class="proto-mobile">
      <ProtoWorkspace />
    </div>
  );
}
