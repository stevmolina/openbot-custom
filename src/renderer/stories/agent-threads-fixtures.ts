import type { AgentTask, ConversationMessage, ConversationSnapshot, QueueDelivery } from "@openbot/contracts/ipc";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";

/** Side threads of Chief for the desktop and web thread stories. */
export const AGENT_ID = "chief";
export const TABS_KEY = "openbot:thread-tabs:v1";

function message(id: string, author: "user" | "assistant", text: string, createdAt: string): ConversationMessage {
  return { id, author, source: author, text, createdAt, status: "completed" };
}

function thread(id: string, title: string, updatedAt: string, fields: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agentId: AGENT_ID,
    threadId: `thread-${id}`,
    origin: "user",
    title,
    state: "idle",
    outcome: "completed",
    hold: null,
    activeTurnId: null,
    progress: null,
    error: null,
    queuedMessages: [],
    createdAt: updatedAt,
    updatedAt,
    closedAt: null,
    ...fields,
  };
}

const PRICING = thread("pricing", "Pricing page copy", "2026-08-19T09:58:00.000Z");

/** A branch of "Pricing page copy" through its headline answer. The menu nests it under its source. */
const PRICING_SHORT = thread("pricing-short", "Pricing page copy #2", "2026-08-19T10:04:00.000Z", {
  branch: {
    sourceTaskId: PRICING.id,
    sourceTitle: PRICING.title,
    sourceMessageId: "pricing-2",
    throughMessageId: "pricing-short-2",
  },
});

/** A branch whose source thread was deleted. Its divider has no link. */
const PRICING_ORPHAN = thread("pricing-orphan", "Pricing FAQ", "2026-08-19T08:20:00.000Z", {
  branch: {
    sourceTaskId: "deleted-thread",
    sourceTitle: null,
    sourceMessageId: "deleted-2",
    throughMessageId: "pricing-orphan-2",
  },
});

const THREADS: AgentTask[] = [
  PRICING_SHORT,
  PRICING,
  thread("pricing-long", "Pricing page copy #3", "2026-08-19T10:01:00.000Z", {
    branch: {
      sourceTaskId: PRICING.id,
      sourceTitle: PRICING.title,
      sourceMessageId: "pricing-2",
      throughMessageId: "pricing-long-2",
    },
  }),
  // A branch of a branch: the line of "#2" runs on past it to "#3".
  thread("pricing-short-alt", "Pricing page copy #4", "2026-08-19T10:06:00.000Z", {
    branch: {
      sourceTaskId: PRICING_SHORT.id,
      sourceTitle: PRICING_SHORT.title,
      sourceMessageId: "pricing-short-2",
      throughMessageId: "pricing-short-alt-2",
    },
  }),
  thread("competitors", "Competitor scan", "2026-08-19T09:50:00.000Z", {
    state: "running",
    outcome: null,
    activeTurnId: "turn-competitors",
    progress: "Reading three pricing pages",
  }),
  thread("release", "Release notes draft", "2026-08-19T09:40:00.000Z", {
    outcome: "failed",
    error: "The provider stopped the turn: usage limit reached.",
  }),
  thread("links", "Check broken links", "2026-08-19T09:30:00.000Z", {
    origin: "agent",
    state: "queued",
    outcome: null,
    hold: "task-limit",
    queuedMessages: [
      { deliveryId: "links-1", text: "Check every link on the docs site.", createdAt: "2026-08-19T09:30:00.000Z" },
    ],
  }),
  PRICING_ORPHAN,
  thread("onboarding", "Old onboarding copy", "2026-08-18T16:00:00.000Z", {
    state: "closed",
    closedAt: "2026-08-18T17:00:00.000Z",
  }),
];

function snapshot(task: AgentTask, messages: ConversationMessage[]): ConversationSnapshot {
  return { agentId: AGENT_ID, threadId: task.threadId, activeTurnId: task.activeTurnId, revision: 1, messages };
}

export const THREAD_OPTIONS: MockOpenBotOptions = {
  tasks: { [AGENT_ID]: THREADS },
  // The open thread shows its context meter, with the Compact action.
  runtimeSnapshot: {
    threadContextStates: [
      {
        agentId: AGENT_ID,
        threadId: PRICING.threadId,
        usage: { usedTokens: 148_000, windowTokens: 258_000, autoCompactAt: 0.8, nativeManaged: false },
        compaction: null,
      },
    ],
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  },
  taskConversations: {
    pricing: snapshot(PRICING, [
      message(
        "pricing-1",
        "user",
        "Write two headline options for the pricing page. Keep them under eight words.",
        "2026-08-19T09:55:00.000Z",
      ),
      message(
        "pricing-2",
        "assistant",
        "Two headline options are in `pricing.md`:\n\n1. **Your team of agents, on your computer.**\n2. **Hire agents. Keep your data.**",
        "2026-08-19T09:58:00.000Z",
      ),
    ]),
    "pricing-short": snapshot(PRICING_SHORT, [
      message(
        "pricing-short-1",
        "user",
        "Write two headline options for the pricing page. Keep them under eight words.",
        "2026-08-19T09:55:00.000Z",
      ),
      message(
        "pricing-short-2",
        "assistant",
        "Two headline options are in `pricing.md`:\n\n1. **Your team of agents, on your computer.**\n2. **Hire agents. Keep your data.**",
        "2026-08-19T09:58:00.000Z",
      ),
      message("pricing-short-3", "user", "Make the second one shorter.", "2026-08-19T10:03:00.000Z"),
      message("pricing-short-4", "assistant", "**Agents that keep your data.**", "2026-08-19T10:04:00.000Z"),
    ]),
    "pricing-orphan": snapshot(PRICING_ORPHAN, [
      message("pricing-orphan-1", "user", "List the questions people ask about pricing.", "2026-08-19T08:10:00.000Z"),
      message(
        "pricing-orphan-2",
        "assistant",
        "The top three: can I pay yearly, what counts as a member, and can I move my license.",
        "2026-08-19T08:12:00.000Z",
      ),
      message("pricing-orphan-3", "user", "Answer each in one sentence.", "2026-08-19T08:18:00.000Z"),
      message(
        "pricing-orphan-4",
        "assistant",
        "Yes, with the yearly switch. A member is a person who signs in. Yes, from Settings.",
        "2026-08-19T08:20:00.000Z",
      ),
    ]),
  },
};

const COMPETITORS_DONE = thread("competitors", "Competitor scan", "2026-08-19T10:07:00.000Z");

/**
 * Chief has unread agent messages in three side threads. "Competitor scan" has finished, so Chief does
 * not work and the sidebar shows the unread count. "Pricing FAQ" has no tab: only the menu shows its dot.
 */
export const UNREAD_OPTIONS: MockOpenBotOptions = {
  ...THREAD_OPTIONS,
  tasks: { [AGENT_ID]: THREADS.map((task) => (task.id === COMPETITORS_DONE.id ? COMPETITORS_DONE : task)) },
  taskConversations: {
    ...THREAD_OPTIONS.taskConversations,
    competitors: snapshot(COMPETITORS_DONE, [
      message(
        "competitors-1",
        "user",
        "Compare the pricing pages of our three closest competitors.",
        "2026-08-19T09:50:00.000Z",
      ),
      message(
        "competitors-2",
        "assistant",
        "All three charge per seat. Only one has a free plan, and none keeps data on the computer. The table is in `competitors.md`.",
        "2026-08-19T10:07:00.000Z",
      ),
    ]),
  },
  taskUnread: { pricing: 1, competitors: 1, "pricing-orphan": 2 },
};

function queued(id: string, text: string, createdAt: string, position: number): QueueDelivery {
  return {
    id,
    messageId: `${id}-message`,
    recipientAgentId: AGENT_ID,
    sender: { kind: "user" },
    text,
    attachments: [],
    replyToMessageId: null,
    status: "queued",
    position,
    turnId: null,
    error: null,
    createdAt,
  };
}

const SERVER_BUSY_QUEUE = [
  queued("busy-1", "Help me create a bot for our hackathon space, please.", "2026-08-19T10:10:00.000Z", 0),
  queued("busy-2", "What happened?", "2026-08-19T10:14:00.000Z", 1),
  queued("busy-3", "What?", "2026-08-19T10:15:00.000Z", 2),
];

const SERVER_BUSY = thread("hackathon-bot", "Hackathon bot", "2026-08-19T10:15:00.000Z", {
  state: "queued",
  outcome: null,
  hold: "server-busy",
  queuedMessages: SERVER_BUSY_QUEUE.map((delivery) => ({
    deliveryId: delivery.id,
    text: delivery.text,
    createdAt: delivery.createdAt,
  })),
  queue: SERVER_BUSY_QUEUE,
});

/**
 * A side thread on a server that is low on memory, with no other thread running. The host names the
 * memory as the hold, so the thread says why it waits and lists the three messages that wait.
 */
export const SERVER_BUSY_OPTIONS: MockOpenBotOptions = {
  ...THREAD_OPTIONS,
  tasks: { [AGENT_ID]: [SERVER_BUSY, PRICING] },
  taskConversations: { ...THREAD_OPTIONS.taskConversations, "hackathon-bot": snapshot(SERVER_BUSY, []) },
};
