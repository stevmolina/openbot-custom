// The first screen of a host: the sidebar and the open chat. All host reads share one ordered data
// channel and the host's work, so on a far host each read also waits for the others. The reads that
// that screen does not show (closed panels, settings, routines, pictures) wait until it shows.
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_FAST_MODE_ROUTES } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { BROWSER_PAGE_STATE_ROUTES } from "@openbot/contracts/team-protocol/browser-page-state-v1";
import { BROWSER_USER_CONTROL_ROUTES } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { MODEL_VISIBILITY_ROUTES } from "@openbot/contracts/team-protocol/model-visibility-v1";
import { SIDEBAR_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";

/**
 * A hold ends by itself after this time, so a host that does not answer the first screen does not hold
 * the rest. A read of that screen that waits for a held read also ends here; keep the list complete.
 */
export const FIRST_SCREEN_HOLD_MS = 5_000;

const FIRST_SCREEN_PATHS: ReadonlySet<string> = new Set([
  // The connect: compatibility, membership, the agents and their models.
  TEAM_API_ROUTES.compatibility,
  TEAM_API_ROUTES.me,
  TEAM_API_ROUTES.agents.all,
  TEAM_API_ROUTES.agents.status,
  TEAM_API_ROUTES.agents.models,
  AGENT_FAST_MODE_ROUTES.models,
  MODEL_VISIBILITY_ROUTES.listing,
  // The sidebar: order, folders, pins, hidden agents, colours, unread counts and channels.
  TEAM_API_ROUTES.sidebarLayout.state,
  SIDEBAR_FOLDERS_ROUTES.read,
  SIDEBAR_PINS_ROUTES.read,
  AGENT_HIDDEN_ROUTES.read,
  AGENT_COLORS_ROUTES.read,
  CHAT_COLORS_ROUTES.read,
  TEAM_API_ROUTES.agents.conversationReads,
  CHANNEL_ROUTES.list,
  // The browser tabs, with the reads that the tab list makes after it.
  TEAM_API_ROUTES.browser.tabs,
  BROWSER_USER_CONTROL_ROUTES.state,
  BROWSER_PAGE_STATE_ROUTES.state,
  // The open chat: the names of its people and the page of an open channel.
  TEAM_API_ROUTES.team.presence,
  CHANNEL_ROUTES.read,
]);
/** The page and the queue of an agent chat. */
const AGENT_CHAT_PATH = /^\/v1\/agents\/[^/]+\/(?:conversation|conversation-page|queue)$/u;
/** A file that a message of the open chat shows. */
const ATTACHMENT_PATH = /^\/v1\/attachments\/[^/]+$/u;

/** True for a request that the first screen of a host shows. */
export function isFirstScreenPath(path: string): boolean {
  const route = path.split("?", 1)[0] ?? path;
  return FIRST_SCREEN_PATHS.has(route) || AGENT_CHAT_PATH.test(route) || ATTACHMENT_PATH.test(route);
}

export interface FirstScreenHold {
  /** Starts a hold and returns its release. A new hold ends the one before it. */
  hold(): () => void;
  /** What a request to `path` waits for, or null when it goes at once. */
  wait(path: string): Promise<void> | null;
  /** Ends the open hold. */
  clear(): void;
}

export function createFirstScreenHold(limitMs = FIRST_SCREEN_HOLD_MS): FirstScreenHold {
  let open: { done: Promise<void>; end: () => void } | null = null;
  return {
    hold() {
      open?.end();
      let resolve = () => {};
      const done = new Promise<void>((settle) => {
        resolve = settle;
      });
      const current = {
        done,
        end: () => {
          clearTimeout(timer);
          resolve();
          if (open === current) open = null;
        },
      };
      const timer = setTimeout(current.end, limitMs);
      open = current;
      return current.end;
    },
    wait(path) {
      return open && !isFirstScreenPath(path) ? open.done : null;
    },
    clear() {
      open?.end();
    },
  };
}
