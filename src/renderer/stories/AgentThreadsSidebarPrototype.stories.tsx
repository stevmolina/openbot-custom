import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  CopySwitcherVariant,
  OpenTabsVariant,
  StatusLanesVariant,
  TabGroupsVariant,
} from "./agent-threads-sidebar-prototype";

const meta = {
  title: "Prototypes/Agent threads sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chosen sidebar: threads grouped by state across all agents, with today's tabs. */
export const StatusLanes: Story = { name: "C. Status lanes", render: () => <StatusLanesVariant /> };
/** Every copy of the agent on screen side by side in the tabs, each copy a labeled group. */
export const TabGroups: Story = { name: "C1. Tabs grouped by copy", render: () => <TabGroupsVariant /> };
/** The tabs of one copy, with a switcher to the other copies. */
export const CopySwitcher: Story = { name: "C2. Copy switcher", render: () => <CopySwitcherVariant /> };
/** Browser-style tabs: any thread of any agent or copy. */
export const OpenTabs: Story = { name: "C3. Open tabs from anywhere", render: () => <OpenTabsVariant /> };
