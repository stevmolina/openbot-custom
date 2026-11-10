import { AVATAR_HUES } from "@openbot/contracts/ipc";
import type { Machine, MachineAgent } from "@openbot/ui/features/servers/MachinesPage";
import { MachinesPage } from "@openbot/ui/features/servers/MachinesPage";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const HOUR = 3_600_000;
const NOW = Date.now();

function agents(names: readonly (readonly [string, string])[], unreadEvery = 0): MachineAgent[] {
  return names.map(([name, title], index) => ({
    id: `${name.toLowerCase().replaceAll(" ", "-")}-${index}`,
    name,
    title,
    avatarSeed: name,
    avatarHue: AVATAR_HUES[index % AVATAR_HUES.length] ?? null,
    avatarColor: null,
    avatarUrl: null,
    updatedAt: index % 7 === 6 ? null : new Date(NOW - index * 5 * HOUR).toISOString(),
    unread: unreadEvery > 0 && index % unreadEvery === 0 ? 2 : 0,
  }));
}

const MACHINES: Machine[] = [
  {
    id: "local",
    name: "Steven's server",
    logoUrl: null,
    state: "online",
    current: true,
    thisComputer: true,
    agents: {
      status: "ready",
      agents: agents([
        ["Builder", "Coding agent"],
        ["Designer", "UI and product design"],
        ["Ops", "Machine upkeep"],
      ]),
    },
  },
  {
    id: "openbot",
    name: "OpenBot",
    logoUrl: null,
    state: "connecting",
    current: false,
    thisComputer: false,
    agents: { status: "loading" },
  },
  {
    id: "personal-vps",
    name: "Personal VPS",
    logoUrl: null,
    state: "online",
    current: false,
    thisComputer: false,
    agents: {
      status: "ready",
      agents: agents(
        [
          ["Inbox", "Personal mail"],
          ["Calendar", "Plans the week"],
          ["UBA notes", "University courses"],
          ["Finance", "Bills and budget"],
          ["Reader", "Saves articles"],
          ["Trips", "Travel plans"],
          ["Health", "Habits and sleep"],
          ["Writer", "Drafts and posts"],
          ["Research", "Deep questions"],
          ["Home", "House tasks"],
          ["Music", "Practice log"],
          ["Shopping", "Lists and prices"],
        ],
        4,
      ),
    },
  },
  {
    id: "resorsi-vps",
    name: "Resorsi VPS",
    logoUrl: null,
    state: "offline",
    current: false,
    thisComputer: false,
    agents: { status: "loading" },
  },
];

const meta = {
  title: "Servers/Machines page",
  component: MachinesPage,
  parameters: { layout: "fullscreen" },
  args: {
    machines: MACHINES,
    onOpenAgent: fn(),
    onRetry: fn(),
    onOpenSettings: fn(),
  },
  render: (args) => (
    <div style={{ height: "100vh" }}>
      <MachinesPage {...args} />
    </div>
  ),
} satisfies Meta<typeof MachinesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Four machines: this computer, one that connects, one with many agents and one that is offline. */
export const AllMachines: Story = {};

/** A machine that answers but whose agents could not be read keeps its place, with a retry. */
export const ReadFailed: Story = {
  args: {
    machines: MACHINES.map((machine) =>
      machine.id === "personal-vps" ? { ...machine, agents: { status: "failed" } } : machine,
    ),
  },
};
