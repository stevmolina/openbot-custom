// Prototype only: the first Pokebots app's plush mascots and icon on today's real app components.
import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { App } from "../src/App";
import { LEFT_PANEL_COLLAPSED_STORAGE_KEY, SERVER_VIEW_STORAGE_KEY } from "../src/layout-constants";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";
import blue from "./assets/pokebots-legacy/blue.webp";
import design from "./assets/pokebots-legacy/design.webp";
import dev from "./assets/pokebots-legacy/dev.webp";
import icon from "./assets/pokebots-legacy/icon-mac.png";
import marketing from "./assets/pokebots-legacy/marketing.webp";
import ops from "./assets/pokebots-legacy/ops.webp";
import orange from "./assets/pokebots-legacy/orange.webp";
import research from "./assets/pokebots-legacy/research.webp";
import sales from "./assets/pokebots-legacy/sales.webp";
import support from "./assets/pokebots-legacy/support.webp";
import { STORY_AGENT_SUMMARIES, STORY_SERVERS } from "./fixtures";

const meta = {
  title: "Prototype/Pokebots branding",
  component: App,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

const EXTRA = [
  { id: "dev", name: "Dev" },
  { id: "design", name: "Design" },
  { id: "marketing", name: "Marketing" },
  { id: "ops", name: "Ops" },
  { id: "support", name: "Support" },
] as const;

const MASCOTS: Record<string, string> = { chief: blue, research, sales, dev, design, marketing, ops, support };

function storyAgents(withMascots: boolean): ClientAgentSummary[] {
  const base = STORY_AGENT_SUMMARIES[2];
  if (!base) throw new Error("The story needs three agents.");
  const extra = EXTRA.map((agent, index) => ({ ...base, ...agent, avatarSeed: `${agent.id}-${index}` }));
  const all = [...STORY_AGENT_SUMMARIES, ...extra];
  if (!withMascots) return all;
  return all.map((agent) => ({ ...agent, avatarUrl: MASCOTS[agent.id] ?? orange }));
}

function useStored(key: string, value: string): void {
  const previous = window.localStorage.getItem(key);
  window.localStorage.setItem(key, value);
  onCleanup(() => {
    if (previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous);
  });
}

function Variant(props: { mascots: boolean; logo: boolean }) {
  useStored(LEFT_PANEL_COLLAPSED_STORAGE_KEY, "false");
  useStored(SERVER_VIEW_STORAGE_KEY, "menu");
  const servers = STORY_SERVERS.map((server) =>
    props.logo && server.kind === "local" ? { ...server, name: "Pokebots", logoUrl: icon } : server,
  );
  return <OpenBotPlayground options={{ agents: storyAgents(props.mascots), servers }} />;
}

/** Today: the generated plush faces. */
export const Today: Story = { render: () => <Variant mascots={false} logo={false} /> };
/** Option A: each agent gets one of the old app's plush mascots as its picture. */
export const MascotFaces: Story = { render: () => <Variant mascots logo={false} /> };
/** Option B: mascots plus the old blue headphones icon as this computer's server mark. */
export const MascotFacesAndIcon: Story = { render: () => <Variant mascots logo /> };
