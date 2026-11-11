import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HALORX_FOLDER_ID, MachineChipsVariant } from "./machine-filter-prototype";

const meta = {
  title: "Prototypes/Machine filter sidebar",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Named chips over "Needs you"; every machine; "Working" open in the dock. */
export const AllMachines: Story = {
  name: "A1. All machines, Working open",
  render: () => <MachineChipsVariant look="named" />,
};

/** One machine chosen: only its chats and its folders; the HaloRx folder open. */
export const OneMachine: Story = {
  name: "A2. Resorsi VPS, HaloRx folder open",
  render: () => <MachineChipsVariant look="named" choice="resorsi-vps" openGroup={HALORX_FOLDER_ID} />,
};

/** Each chip counts the chats of its machine that need you; "Settled" open. */
export const NeedsYouCounts: Story = {
  name: "A3. Needs-you counts, Settled open",
  render: () => <MachineChipsVariant look="needs-you" openGroup={SIDEBAR_UNASSIGNED_SECTION_ID} />,
};

/** Logo chips; the chosen chip shows its name. */
export const LogoChips: Story = {
  name: "A4. Logo chips, Personal VPS",
  render: () => <MachineChipsVariant look="logos" choice="personal-vps" />,
};
