import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AgentMessage } from "@openbot/ui/data";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { createEffect, createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ThreadVisualReply } from "../src/features/conversation/ThreadVisualReply";
import { STORY_AGENT } from "../src/preview/fixtures";
import { publishChatVisualPage } from "./chat-visual-fixtures";

const HTML =
  '<p id="result">Loading</p><script>document.getElementById("result").textContent="Inline page script ran"</script>';
const messages: AgentMessage[] = [
  {
    id: "visual",
    author: "agent",
    body: "Inline HTML demo",
    time: "12:00",
    itemType: "visual-reply:",
    attachments: [
      {
        id: "visual-file",
        name: "Inline HTML demo.html",
        size: HTML.length,
        kind: "file",
        mimeType: "text/html",
        previewKind: "text",
        previewUrl: "openbot-attachment://file/visual-file",
      },
    ],
  },
  {
    id: "ordinary",
    author: "agent",
    body: "Ordinary HTML attachment",
    time: "12:00",
    attachments: [
      {
        id: "ordinary-file",
        name: "ordinary.html",
        size: 10,
        kind: "file",
        mimeType: "text/html",
        previewKind: "text",
        previewUrl: null,
      },
    ],
  },
];

/** The real side-thread container, with a visual reply and an ordinary HTML file. */
function ThreadStage(props: { web?: boolean; failed?: boolean }) {
  const [src, setSrc] = createSignal<string>();
  createEffect(
    () => props.web,
    (web) => {
      if (!web) void publishChatVisualPage(HTML).then(setSrc);
    },
  );
  return (
    <AgentThreadView
      task={null}
      limit={2}
      agent={STORY_AGENT}
      agents={[STORY_AGENT]}
      messages={messages}
      draft=""
      onDraftChange={() => undefined}
      onSend={async () => false}
      onStop={() => undefined}
      onRespondApproval={async () => false}
      onOpenLink={() => undefined}
      onPreview={() => undefined}
      onAttachmentAction={() => undefined}
      messageCard={(message) => {
        const visual = chatVisualReply(message);
        if (!visual) return undefined;
        return (
          <ThreadVisualReply
            message={message}
            visual={visual}
            src={props.web ? undefined : src()}
            load={
              props.web
                ? async () => {
                    if (props.failed) throw new Error("unavailable");
                    return HTML;
                  }
                : undefined
            }
            onOpenLink={() => undefined}
            macWindowControls={true}
          />
        );
      }}
    />
  );
}
const meta = {
  title: "Conversation/Thread visual replies",
  component: ThreadStage,
  parameters: { layout: "fullscreen" },
  render: (args) => <ThreadStage {...args} />,
} satisfies Meta<typeof ThreadStage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {};
export const Web: Story = { args: { web: true } };
export const Unavailable: Story = { args: { web: true, failed: true } };
