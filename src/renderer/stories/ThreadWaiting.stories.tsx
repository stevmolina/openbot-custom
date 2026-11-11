import type { AgentTask, QueueDelivery } from "@openbot/contracts/ipc";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT } from "../src/preview/fixtures";

const TEXT = "help me create a HackaSpace bot please";
const CREATED = "2026-11-11T12:00:00.000Z";

const delivery: QueueDelivery = {
  id: "delivery-1",
  messageId: "message-1",
  recipientAgentId: STORY_AGENT.id,
  sender: { kind: "user" },
  text: TEXT,
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: CREATED,
};

/** A new thread whose first message waits, because the other threads of the agent use every slot. */
function waitingTask(rows: "queue" | "preview" | "none"): AgentTask {
  return {
    id: "task-1",
    agentId: STORY_AGENT.id,
    threadId: "thread-1",
    origin: "user",
    title: TEXT,
    state: "queued",
    outcome: null,
    hold: "task-limit",
    activeTurnId: null,
    progress: null,
    error: null,
    queuedMessages: rows === "none" ? [] : [{ deliveryId: delivery.id, text: TEXT, createdAt: CREATED }],
    queue: rows === "queue" ? [delivery] : undefined,
    createdAt: CREATED,
    updatedAt: CREATED,
    closedAt: null,
  };
}

/**
 * The real side-thread view of a new thread that waits for a free thread. `queue` is this computer,
 * `preview` a joined server that sends only the start of each message, and `none` a host that sent
 * no queued rows at all.
 */
function WaitingStage(props: { rows: "queue" | "preview" | "none" }) {
  const task = () => waitingTask(props.rows);
  return (
    <AgentThreadView
      task={task()}
      limit={4}
      agent={STORY_AGENT}
      agents={[STORY_AGENT]}
      messages={[]}
      draft=""
      onDraftChange={() => undefined}
      onSend={async () => false}
      onStop={() => undefined}
      onRespondApproval={async () => false}
      onOpenLink={() => undefined}
      onPreview={() => undefined}
      onAttachmentAction={() => undefined}
      queue={
        props.rows === "queue"
          ? {
              deliveries: task().queue ?? [],
              editingDeliveryId: null,
              editBusy: false,
              onCancel: () => undefined,
              onEdit: () => undefined,
              onCancelEdit: () => undefined,
              onReorder: () => undefined,
            }
          : undefined
      }
    />
  );
}

const meta = {
  title: "Conversation/Thread waiting",
  component: WaitingStage,
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div class="conversation" style={{ height: "100vh", display: "flex", "flex-direction": "column" }}>
      <WaitingStage {...args} />
    </div>
  ),
} satisfies Meta<typeof WaitingStage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ThisComputer: Story = { args: { rows: "queue" } };
export const JoinedServer: Story = { args: { rows: "preview" } };
export const NoQueuedRows: Story = { args: { rows: "none" } };
