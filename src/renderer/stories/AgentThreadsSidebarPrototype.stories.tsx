import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { LanesWithOpenTabsVariant } from "./agent-threads-sidebar-prototype";

const meta = {
  title: "Prototypes/Agent threads sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Threads by state, then every bot once as a quiet list with its role. Tabs from anywhere on top. */
export const AgentsList: Story = {
  name: "D1. Quiet agents as a list",
  render: () => <LanesWithOpenTabsVariant agents="list" />,
};
/** The same, with the quiet bots as a grid of faces. */
export const AgentsGrid: Story = {
  name: "D2. Quiet agents as a grid",
  render: () => <LanesWithOpenTabsVariant agents="grid" />,
};
