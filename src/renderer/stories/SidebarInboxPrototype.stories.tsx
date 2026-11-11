import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AccordionDockVariant,
  CurrentSidebarVariant,
  FaceShelfVariant,
  TabbedDrawerVariant,
} from "./sidebar-inbox-prototype";

const meta = {
  title: "Prototypes/Sidebar inbox and dock",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sidebar as it ships now, with the same chats. */
export const Current: Story = { name: "0. Current sidebar", render: () => <CurrentSidebarVariant /> };
/** "Needs you" on top; the other groups at the bottom open one at a time. */
export const AccordionDock: Story = { name: "A. Accordion dock", render: () => <AccordionDockVariant /> };
/** "Needs you" on top; one drawer at the bottom with tabs. */
export const TabbedDrawer: Story = { name: "B. Tabbed drawer", render: () => <TabbedDrawerVariant /> };
/** "Needs you" on top; the other groups as lines of faces. */
export const FaceShelf: Story = { name: "C. Face shelf", render: () => <FaceShelfVariant /> };
