/**
 * One chat of the chat list: an agent or a channel. The open sidebar shows a row with the face, the
 * name and the last message. The collapsed sidebar shows the face alone, with the name and the last
 * message in its tooltip. Both have the context menu of the chat.
 *
 * A chat that waits for the user shows the wait in place of the last message, in the warning color.
 * The face shows that the agent works or waits through its mood. A dot marks a reply that the user
 * did not read.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { buttonVariants, ContextMenu, MotionTooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { MAIN_THREAD_ID } from "../conversation/threads/thread-types";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator } from "./SidebarAgentIndicator";
import { SidebarChannelContextMenu } from "./SidebarChannelContextMenu";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_TITLE, sidebarAgentStateLabel } from "./sidebar-filtering";
import { sidebarAgentWait } from "./sidebar-recent-chats";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarChannelWait, SidebarChatItem } from "./sidebar-types";

/** How a chat shows: a row of the open list, or a face of the collapsed dock. */
export type SidebarChatLook = "row" | "face";

/** What one chat shows, the same for its row and its face. */
interface ChatView {
  name: string;
  preview: string;
  waiting: boolean;
  unread: boolean;
  active: boolean;
  /** The words a screen reader reads after the name and the preview, such as the state. */
  extraLabel: string;
  avatar: () => JSX.Element;
  /** A mark on the face for a state that the mood does not show, such as a routine. */
  mark: () => JSX.Element;
  menu: () => JSX.Element;
  open: () => void;
}

/** A chat shows as open only while the page of the chats is on screen, not under another page. */
function useChatsOnScreen() {
  const { props } = useSidebarScope();
  return () => {
    const current = props.pages?.current;
    return current === undefined || current === "chats" || current === "routines";
  };
}

/** The wait as the preview line says it: the action and the question, or the wait alone. */
function useWaitText() {
  const { t } = useText();
  return (wait: SidebarChannelWait) =>
    wait.detail
      ? t("sidebar.state.waitingDetail", { state: t(SIDEBAR_WAIT_ACTION[wait.reason]), detail: wait.detail })
      : t(SIDEBAR_WAIT_TITLE[wait.reason]);
}

function useAgentView(agent: () => AgentProfile, pinned: () => boolean): ChatView {
  const { props } = useSidebarScope();
  const { t, format } = useText();
  const waitText = useWaitText();
  const chatsOnScreen = useChatsOnScreen();
  const state = () => props.agentStates[agent().id];
  const wait = () => sidebarAgentWait(agent().id, state(), props.threadLanes?.threads);
  // A function, not a JSX ternary: the avatar reads its mood inside an effect.
  const mood = () => props.agentMoods[agent().id] ?? "idle";
  const markState = () => {
    const current = state();
    return current?.kind === "routine" || current?.kind === "limited" ? current : undefined;
  };
  const stateLabel = () => {
    const current = state();
    return current ? sidebarAgentStateLabel(current, t, format) : "";
  };
  return {
    get name() {
      return agent().name;
    },
    get preview() {
      const current = wait();
      return current ? waitText(current.state) : agent().preview;
    },
    get waiting() {
      return wait() !== undefined;
    },
    get unread() {
      return state()?.kind === "unread" || (props.threadLanes?.unreadAgentIds.has(agent().id) ?? false);
    },
    get active() {
      return chatsOnScreen() && props.activeAgentId === agent().id;
    },
    get extraLabel() {
      return wait() ? "" : stateLabel();
    },
    avatar: () => <AgentAvatar agent={agent()} motion="idle" mood={mood()} />,
    mark: () => <SidebarAgentIndicator state={markState} />,
    menu: () => <SidebarAgentContextMenu agent={agent()} pinned={pinned()} />,
    open: () => {
      const current = wait();
      const lanes = props.threadLanes;
      if (current && lanes && current.threadId !== MAIN_THREAD_ID) lanes.onOpenThread(agent().id, current.threadId);
      else props.onSelectAgent(agent().id);
    },
  };
}

function useChannelView(channel: () => ChannelSummary, pinned: () => boolean): ChatView {
  const { props } = useSidebarScope();
  const { t } = useText();
  const waitText = useWaitText();
  const chatsOnScreen = useChatsOnScreen();
  const wait = () => props.channelWaits?.[channel().id];
  // A channel from a saved frame has no last message yet: it shows no preview until the list loads.
  const previewPending = () => props.channelPreviewsPending === true && !channel().lastMessage;
  return {
    get name() {
      return channel().name;
    },
    get preview() {
      const current = wait();
      if (current) return waitText(current);
      const text = channel().lastMessage?.text ?? (previewPending() ? "" : t("sidebar.channel.noMessages"));
      return channel().activeTasks > 0 ? t("sidebar.channel.workingPreview", { preview: text }) : text;
    },
    get waiting() {
      return wait() !== undefined;
    },
    get unread() {
      return channel().unreadCount > 0;
    },
    get active() {
      return chatsOnScreen() && props.activeChannelId === channel().id;
    },
    get extraLabel() {
      return channel().unreadCount > 0 ? t("sidebar.channel.unread", { count: channel().unreadCount }) : "";
    },
    avatar: () => <ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />,
    mark: () => null,
    menu: () => <SidebarChannelContextMenu channel={channel()} pinned={pinned()} />,
    open: () => props.onSelectChannel?.(channel().id),
  };
}

export function SidebarChatRow(rowProps: { chat: SidebarChatItem; look: SidebarChatLook; pinned?: boolean }) {
  const pinned = () => rowProps.pinned === true;
  const agent = () => (rowProps.chat.kind === "agent" ? rowProps.chat.agent : undefined);
  const channel = () => (rowProps.chat.kind === "channel" ? rowProps.chat.channel : undefined);
  return (
    <Switch>
      <Match when={agent()}>
        {(profile) => <SidebarChatView view={useAgentView(profile, pinned)} look={rowProps.look} />}
      </Match>
      <Match when={channel()}>
        {(summary) => <SidebarChatView view={useChannelView(summary, pinned)} look={rowProps.look} />}
      </Match>
    </Switch>
  );
}

function SidebarChatView(viewProps: { view: ChatView; look: SidebarChatLook }) {
  const { t } = useText();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const view = viewProps.view;
  // The preview can end with its own full stop, so the label does not add a second one.
  const label = () =>
    [
      view.name,
      view.preview.replace(/[.!?…]\s*$/u, ""),
      view.extraLabel || (view.unread ? t("sidebar.chat.unread") : ""),
    ]
      .filter(Boolean)
      .join(". ");
  const trigger = () => (
    <ContextMenu.Root modal={false} onOpenChange={setMenuOpen}>
      <ContextMenu.Trigger
        as="button"
        type="button"
        class={[
          buttonVariants({ variant: "ghost" }),
          viewProps.look === "row" ? "sidebar-chat-row" : "sidebar-chat-face",
          { "sidebar-chat-active": view.active },
        ]}
        aria-label={label()}
        aria-current={view.active ? "page" : undefined}
        data-cuelume-navigate=""
        onClick={() => view.open()}
      >
        <span class="sidebar-chat-avatar">
          {view.avatar()}
          {view.mark()}
        </span>
        <Show when={viewProps.look === "row"}>
          <span class="sidebar-chat-copy" aria-hidden="true">
            <strong class="sidebar-chat-name">{view.name}</strong>
            <span class={["sidebar-chat-preview", { "sidebar-chat-preview-wait": view.waiting }]}>{view.preview}</span>
          </span>
        </Show>
        <Show when={view.unread}>
          <span class="sidebar-chat-unread" aria-hidden="true" />
        </Show>
      </ContextMenu.Trigger>
      {view.menu()}
    </ContextMenu.Root>
  );
  return (
    <Show when={viewProps.look === "face"} fallback={trigger()}>
      <MotionTooltip
        class="ui-popover-menu-surface sidebar-chat-tip"
        suppressed={menuOpen()}
        content={
          <>
            <strong>{view.name}</strong>
            <Show when={view.preview}>
              <span class={{ "sidebar-chat-preview-wait": view.waiting }}>{view.preview}</span>
            </Show>
          </>
        }
      >
        {trigger()}
      </MotionTooltip>
    </Show>
  );
}
