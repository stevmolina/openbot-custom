import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { MessageReaction } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { BackgroundWorkers } from "@openbot/ui/features/conversation/BackgroundWorkers";
import type { JSX } from "@solidjs/web";
import { createMemo } from "solid-js";
import { agentAwaitingReplies } from "../../awaiting-replies";
import { backgroundWorkerItems } from "./background-worker-items";
import { chatVisualPageUrl } from "./chat-visual-url";
import { useConversationViewScope } from "./conversation-scope";
import { ThreadVisualReply } from "./ThreadVisualReply";
import { threadReadAloud } from "./thread-read-aloud";

/**
 * The OpenBot Custom additions to a thread view: background worker rows above the message box, HTML
 * visual replies, reactions and read aloud. They live here, so the upstream thread hosts each keep
 * only one hook call and a few props.
 */
export function useCustomThreadExtras(input: {
  messages: readonly AgentMessage[];
  /** The task that the view shows. Its own row does not show above its message box. */
  excludeTaskId: () => string | undefined;
}) {
  const { props, awaitingReplies, toggleSubagentPanel, openExternalMessageUrl, reactToMessage } =
    useConversationViewScope();
  /** The same worker rows as the chat. Rows are keyed by id, so a streamed token does not draw them again. */
  const workers = createMemo(() => {
    const replies = new Map(awaitingReplies().map((item) => [item.id, item]));
    for (const item of agentAwaitingReplies({
      messages: input.messages,
      queue: props.queue?.agentId === props.agent?.id ? props.queue : undefined,
      agents: props.agents,
      self: props.agent,
      waits: props.agentWaits,
    }))
      replies.set(item.id, item);
    return backgroundWorkerItems({
      agent: props.agent,
      messages: input.messages,
      tasks: props.threads?.background ?? [],
      excludeTaskId: input.excludeTaskId(),
      replies: replies.values(),
      onOpenSubagent: toggleSubagentPanel,
      onOpenTask: (id) => props.threads?.header.onOpen(id),
      onOpenAgent: props.onSelectAgent,
    });
  });
  return {
    aboveComposer: (): JSX.Element => <BackgroundWorkers items={workers()} />,
    /** The visual page of an HTML reply, in the place of its message row. Undefined keeps the row. */
    visualCard: (message: AgentMessage): JSX.Element | undefined => {
      const visual = chatVisualReply(message);
      if (!visual) return undefined;
      const src = chatVisualPageUrl(visual.attachment.previewUrl);
      const load = props.runtime?.visualPage;
      if (!src && !load) return undefined;
      return (
        <ThreadVisualReply
          message={message}
          visual={visual}
          src={src}
          load={load}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
          macWindowControls={props.platform === "darwin"}
        />
      );
    },
    onReact: (message: AgentMessage, emoji: MessageReaction | null) => void reactToMessage(message, emoji),
    readAloud: (message: AgentMessage) =>
      threadReadAloud(props.runtime !== undefined, props.server?.id ?? "local", props.agent?.id, message),
  };
}
