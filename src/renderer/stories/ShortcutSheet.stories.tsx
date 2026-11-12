import { Button, Heading } from "@openbot/ui";
import { HoldShortcutOverlay } from "@openbot/ui/features/shortcuts/HoldShortcutOverlay";
import { ShortcutSheet, type ShortcutSheetProps } from "@openbot/ui/features/shortcuts/ShortcutSheet";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

type DemoProps = Omit<ShortcutSheetProps, "open" | "onOpenChange">;

/** Owns the open state the way the app does: the button and ⌘/ open it, Escape closes it. */
function ShortcutSheetDemo(props: DemoProps) {
  const [open, setOpen] = createSignal(true);
  return (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Keyboard shortcuts
      </Heading>
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        Show shortcuts
      </Button>
      <ShortcutSheet {...props} open={open()} onOpenChange={setOpen} />
    </main>
  );
}

const meta = {
  title: "Foundations/ShortcutSheet",
  component: ShortcutSheetDemo,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: { platform: "mac" },
} satisfies Meta<typeof ShortcutSheetDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mac: Story = {};

export const WindowsAndLinux: Story = { args: { platform: "pc" } };

/** The web client leaves out the keys that the browser keeps. */
export const WebClient: Story = {
  args: {
    hidden: [
      "newChat",
      "historyBack",
      "historyForward",
      "switchServer",
      "settings",
      "findInChat",
      "findNext",
      "findPrevious",
      "copyLastReply",
      "copyLastCode",
      "stopAgent",
      "stopAllAgents",
      "zoomIn",
      "zoomOut",
      "actualSize",
      "browserNewTab",
      "browserReopenTab",
      "browserCloseTab",
      "browserAddress",
      "browserReload",
      "browserBack",
      "browserForward",
      "browserNextTab",
      "browserPreviousTab",
      "browserSelectTab",
    ],
  },
};

/** The passive sheet uses the same keys and theme as the interactive dialog. */
export const HoldModifier: Story = {
  render: (props) => <HoldShortcutOverlay open platform={props.platform} windows={false} sendShortcut="enter" />,
};

export const HoldControl: Story = {
  args: { platform: "pc" },
  render: (props) => <HoldShortcutOverlay open platform={props.platform} windows sendShortcut="ctrl-enter" />,
};
