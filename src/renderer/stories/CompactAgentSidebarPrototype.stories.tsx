import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PillVariant, SeeMoreVariant, ShortcutsVariant } from "./compact-agent-sidebar-prototype";

const meta = {
  title: "Prototypes/Compact agent sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  globals: { colorScheme: "light" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The pill holds Chats, Workflows, Tasks and More; the provider rings sit above it. */
export const Pill: Story = { name: "A1. Pill and More", render: () => <PillVariant /> };
/** A1 collapsed: faces, then the provider rings and the same pill, upright. */
export const PillCollapsed: Story = { name: "A1. Collapsed", render: () => <PillVariant collapsed /> };
/** Labelled shortcuts under the top bar; both accounts, the rings and Settings at the bottom. */
export const Shortcuts: Story = { name: "A2. Shortcut row", render: () => <ShortcutsVariant /> };
/** A2 collapsed: the shortcuts under the top buttons, the rings and account at the bottom. */
export const ShortcutsCollapsed: Story = {
  name: "A2. Collapsed",
  render: () => <ShortcutsVariant collapsed />,
};
/** Three pages as rows above the chats, "See more" for the rest, and an account card. */
export const SeeMore: Story = { name: "A3. See more", render: () => <SeeMoreVariant /> };
/** A3 with "See more" open. */
export const SeeMoreOpen: Story = { name: "A3. See more, open", render: () => <SeeMoreVariant expanded /> };
/** A3 collapsed: faces, then the three pages, More, the rings and the account. */
export const SeeMoreCollapsed: Story = { name: "A3. Collapsed", render: () => <SeeMoreVariant collapsed /> };
