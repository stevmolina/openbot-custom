import { BackgroundWorkers } from "@openbot/ui/features/conversation/BackgroundWorkers";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const meta = {
  title: "Conversation/Background workers",
  component: BackgroundWorkers,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BackgroundWorkers>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReferenceRow: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    const [active, setActive] = createSignal(true);
    return (
      <>
        <BackgroundWorkers
          items={
            active()
              ? [
                  {
                    id: "worker",
                    agent: STORY_AGENTS[0],
                    title: "Add background worker visibility",
                    since: new Date(Date.now() - 89_000).toISOString(),
                    state: "running",
                    onOpen: () => {
                      setOpen(true);
                      setActive(false);
                    },
                  },
                ]
              : []
          }
        />
        <output>{open() ? "Worker details opened" : ""}</output>
      </>
    );
  },
};
