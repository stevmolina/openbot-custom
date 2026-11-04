import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { LanesWithOpenTabsVariant } from "./agent-threads-sidebar-prototype";

const meta = {
  title: "Prototypes/Agent threads sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Threads by state in the sidebar. On top, browser-style tabs: any thread of any agent or copy. */
export const LanesWithOpenTabs: Story = {
  name: "C3. Status lanes and open tabs",
  render: () => <LanesWithOpenTabsVariant />,
};
