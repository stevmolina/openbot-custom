import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChatListVariant, DockVariant, LanesVariant } from "./compact-agent-sidebar-prototype";

const meta = {
  title: "Prototypes/Compact agent sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  globals: { colorScheme: "light" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The reference as is: one list by last message, the views in a pill at the bottom, no page rail. */
export const ChatList: Story = { name: "A. Chat list", render: () => <ChatListVariant /> };
/** The real top bar, search and page rail stay. The rows become chat rows, grouped by what they need. */
export const Lanes: Story = { name: "B. Chat rows in lanes", render: () => <LanesVariant /> };
/** Faces only, names on hover. The chat gets the most room. */
export const Dock: Story = { name: "C. Face dock", render: () => <DockVariant /> };
