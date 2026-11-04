import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { createEffect, createSignal } from "solid-js";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";

/** The side thread's visual page uses the same sandbox as the agent's main chat. */
export function ThreadVisualReply(props: {
  message: AgentMessage;
  visual: { attachment: AttachmentSummary; height?: number };
  src: string | undefined;
  load: ((attachment: AttachmentSummary) => Promise<string>) | undefined;
  onOpenLink: (url: string) => void;
  macWindowControls: boolean;
}) {
  const [page, setPage] = createSignal<{ html?: string; failed?: boolean }>({});
  createEffect(
    () => ({ src: props.src, load: props.load, attachment: props.visual.attachment }),
    ({ src, load, attachment }) => {
      setPage({});
      if (src || !load) return;
      let current = true;
      void load(attachment).then(
        (html) => current && setPage({ html }),
        () => current && setPage({ failed: true }),
      );
      return () => {
        current = false;
      };
    },
  );
  return (
    <article data-chat-search-message={props.message.id} aria-label={props.message.body}>
      <ChatVisual
        src={props.src}
        html={page().html}
        failed={!props.src && page().failed === true}
        title={props.message.body}
        height={props.visual.height}
        onOpenLink={props.onOpenLink}
        isAppShortcut={isChatVisualAppShortcut}
        macWindowControls={props.macWindowControls}
      />
    </article>
  );
}
