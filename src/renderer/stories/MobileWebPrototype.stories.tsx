import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FolderChipsVariant, FolderScreensVariant, OneListVariant, TodayVariant } from "./mobile-web-prototype";

const meta = {
  title: "Prototypes/Mobile web",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Today's phone layout with eight folders. */
export const Today: Story = { name: "0. Today", render: () => <TodayVariant /> };
/** Every folder open in one scroll, one tab bar. */
export const OneList: Story = { name: "A. One list", render: () => <OneListVariant /> };
/** A chip per folder over one list, no bar at the bottom. */
export const FolderChips: Story = { name: "B. Folder chips", render: () => <FolderChipsVariant /> };
/** Each folder is a row that opens its own screen. */
export const FolderScreens: Story = { name: "C. Folder screens", render: () => <FolderScreensVariant /> };
