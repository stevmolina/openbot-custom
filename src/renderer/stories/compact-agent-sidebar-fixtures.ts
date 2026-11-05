import type { AvatarHue, ClientAgentSummary } from "@openbot/contracts/ipc";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";

/** What the prototype shows for an agent beside the data that the mock app has. */
export interface PrototypeAgent {
  id: string;
  name: string;
  title: string;
  hue: AvatarHue;
  preview: string;
  time: string;
  state?: "working" | "waiting";
  waitReason?: string;
  unread?: boolean;
}

/** The agents of the reference screenshot, newest first. */
export const PROTOTYPE_AGENTS: PrototypeAgent[] = [
  {
    id: "search-visibility",
    name: "Search Visibility Audit",
    title: "SEO analyst",
    hue: 150,
    preview: "Your biggest opportunity is the pricing page. It ranks 14th for 'AI agents app'.",
    time: "10:02",
    unread: true,
  },
  {
    id: "prototype",
    name: "Prototype",
    title: "Design prototyper",
    hue: 280,
    preview: "Ya están los dos MP4 en la carpeta de demos.",
    time: "9:48",
    state: "working",
  },
  {
    id: "tool-scout",
    name: "Tool Scout",
    title: "Tool researcher",
    hue: 245,
    preview: "I've opened the hero in the preview so you can compare both versions.",
    time: "9:30",
  },
  {
    id: "master",
    name: "Master",
    title: "Chief of staff",
    hue: 320,
    preview: "Created Search Visibility Audit and gave it the SEO brief.",
    time: "9:12",
  },
  {
    id: "product-design",
    name: "Product Design Lead",
    title: "Design lead",
    hue: 245,
    preview: "List and top chrome match the reference now.",
    time: "Yesterday",
  },
  {
    id: "social-media",
    name: "Social Media",
    title: "Social media manager",
    hue: 0,
    preview: "Yes, Composio is connected to LinkedIn and X.",
    time: "Yesterday",
    state: "waiting",
    waitReason: "Approve 3 posts",
  },
  {
    id: "personal-organizer",
    name: "Personal Organizer",
    title: "Personal assistant",
    hue: 55,
    preview: "Nothing was saved. Send me the list again?",
    time: "Mon",
  },
  {
    id: "sales",
    name: "Sales",
    title: "Sales outbound",
    hue: 320,
    preview: "Created and verified both sequences in EmailBison.",
    time: "Mon",
  },
];

/** The two accounts the user switches between. Each one is a server with its own agents. */
export const PROTOTYPE_ACCOUNTS = [
  { id: "personal", name: "Personal", server: "Local", detail: "This Mac", seed: "local" },
  { id: "resorsi", name: "Resorsi", server: "Resorsi VPS", detail: "Remote server", seed: "Resorsi VPS" },
] as const;

export type PrototypeAccountId = (typeof PROTOTYPE_ACCOUNTS)[number]["id"];

/** The AI provider accounts with plan limits, as the usage rings of the page rail show them. */
export const PROTOTYPE_PROVIDERS = [
  {
    provider: "claude",
    name: "Claude Max",
    windows: [
      { label: "5-hour", remaining: 62, tone: "ok" },
      { label: "Weekly", remaining: 80, tone: "ok" },
    ],
  },
  {
    provider: "codex",
    name: "ChatGPT Pro",
    windows: [
      { label: "5-hour", remaining: 18, tone: "warning" },
      { label: "Weekly", remaining: 54, tone: "ok" },
    ],
  },
] as const;

export type PrototypeProvider = (typeof PROTOTYPE_PROVIDERS)[number];

export const PROTOTYPE_AGENT_BY_ID = new Map(PROTOTYPE_AGENTS.map((agent) => [agent.id, agent]));

const STORY_NOW = Date.parse("2026-08-19T10:02:00.000Z");

const SUMMARIES: ClientAgentSummary[] = PROTOTYPE_AGENTS.map((agent, index) => ({
  id: agent.id,
  provider: index % 2 === 0 ? "claude" : "codex",
  name: agent.name,
  title: agent.title,
  description: agent.preview,
  notifications: true,
  model: index % 2 === 0 ? "claude-sonnet-5" : "gpt-5.6-terra",
  reasoningEffort: "medium",
  access: "full",
  threadId: `thread-${agent.id}`,
  workspacePath: `/mock/OpenBot/Agents/${agent.id}`,
  preview: agent.preview,
  updatedAt: new Date(STORY_NOW - index * 20 * 60_000).toISOString(),
  avatarSeed: agent.id,
  avatarHue: agent.hue,
  avatarUrl: null,
}));

/** The mock app with the agents of the reference screenshot. */
export const PROTOTYPE_OPTIONS: MockOpenBotOptions = { agents: SUMMARIES };
