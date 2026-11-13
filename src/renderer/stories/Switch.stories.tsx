import { Heading, Switch, SwitchField } from "@openbot/ui";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Foundations/Switch",
  component: Switch,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {
  args: {},
  render: () => {
    const [checked, setChecked] = createSignal(false);
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Switches
        </Heading>
        <div class="foundation-story-stack" style={{ "max-width": "440px" }}>
          <SwitchField
            checked={checked()}
            onChange={setChecked}
            label="Desktop notifications"
            description="Receive updates when an agent finishes."
          />
          <SwitchField defaultChecked size="sm" label="Compact enabled" />
          <SwitchField disabled label="Disabled setting" />
          <SwitchField validationState="invalid" label="Invalid setting" />
          <div style={{ display: "flex", "align-items": "center", gap: "16px" }}>
            <Switch aria-label="Default off" />
            <Switch defaultChecked aria-label="Default on" />
            <Switch size="sm" aria-label="Small off" />
            <Switch defaultChecked size="sm" aria-label="Small on" />
          </div>
        </div>
      </main>
    );
  },
};

const SAVE_DELAY_MS = 600;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A slow save, as over a far host. The switch moves at once. The saved value follows after 600 ms. When the save
 * fails, the switch goes back to the saved value by itself.
 */
export const SlowSave: Story = {
  args: {},
  render: () => {
    const [saved, setSaved] = createSignal(false);
    const [failing, setFailing] = createSignal(false);
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Slow save
        </Heading>
        <div class="foundation-story-stack" style={{ "max-width": "440px" }}>
          <SwitchField
            checked={saved()}
            onChange={async (next) => {
              await wait(SAVE_DELAY_MS);
              if (failing()) throw new Error("The host did not answer.");
              setSaved(next);
            }}
            label="Saves in 600 ms"
            description={`Saved value: ${saved() ? "on" : "off"}`}
          />
          <SwitchField
            checked={failing()}
            onChange={setFailing}
            label="Make the next save fail"
            description="The switch above then moves and goes back after 600 ms."
          />
        </div>
      </main>
    );
  },
};
