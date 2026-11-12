import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { OneListVariant, TodayVariant } from "./mobile-web-prototype";

const meta = {
  title: "Prototypes/Mobile web",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Today's phone layout with eight folders. */
export const Today: Story = { name: "0. Today", render: () => <TodayVariant /> };
/** Every folder open in one scroll, a smaller title, and a floating tab bar. */
export const OneList: Story = { name: "A. One list", render: () => <OneListVariant /> };
