import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CopyPerProjectVariant, NestedCopiesVariant, StatusLanesVariant } from "./agent-threads-sidebar-prototype";

const meta = {
  title: "Prototypes/Agent threads sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Agent, then each copy, then its threads. Copies of one agent stay in one group. */
export const NestedCopies: Story = { name: "A. Nested copies", render: () => <NestedCopiesVariant /> };
/** Each copy is its own project with a badge. Copies sit next to each other. */
export const CopyPerProject: Story = { name: "B. Copy per project", render: () => <CopyPerProjectVariant /> };
/** Threads grouped by state across all agents. */
export const StatusLanes: Story = { name: "C. Status lanes", render: () => <StatusLanesVariant /> };
