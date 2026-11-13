import type {
  AgentDockAction,
  AgentDockChannel,
  AgentDockPresentation,
  AgentDockSeatRef as AgentDockSeatContract,
} from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChatModel,
  type AgentDockSeat,
  type AgentDockSeatRef,
  type AgentDockShapeRect,
  type AgentDockChannel as AgentDockUiChannel,
  agentDockBody,
  agentDockSeatKey,
} from "@openbot/ui/features/agent-dock/AgentDock";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { currentDevicePlatform } from "../../send-shortcut-preference";
import { windowShape } from "../../window-shape";
import {
  AGENT_DOCK_STRIP_FEEL,
  AGENT_DOCK_STRIP_REST,
  AGENT_DOCK_STRIP_WIDTH,
  AgentDockEdgeStrip,
} from "./AgentDockEdgeStrip";
import { agentDockPort } from "./agent-dock-port";
import { createAgentDockVoice } from "./agent-dock-voice";

/** The time without use before the dock slides into the edge, when the user wants it hidden. */
const TUCK_DELAY_MS = 900;
/** A new reply keeps a hidden dock out this long. A question keeps it out until the question ends. */
const REPLY_PEEK_MS = 6000;
/** The width of the strip at the screen edge where the pointer brings a hidden dock back. */
const EDGE_STRIP = 4;
/**
 * Linux gives no pointer moves to a window that lets the pointer through. There the window shape is
 * the dock: the pointer goes to the apps outside it, and nothing outside it shows.
 */
const SHAPED_WINDOW = currentDevicePlatform() === "linux";
/**
 * Windows gives this window the pointer moves only in the zone that it reports: each forwarded move holds
 * the cursor of the whole computer until main has it. The zone is the dock parts and the strip, out to
 * the distance where the strip feels the pointer.
 */
const POINTER_ZONE_WINDOW = currentDevicePlatform() === "win32";

/**
 * The agent dock in its own window at the left or right edge of the screen. The main renderer owns the
 * conversations: this window shows what it publishes and sends each action back. Main sends the
 * messages typed here.
 *
 * The window lets the pointer through, except over the dock shapes. It takes key input while a chat
 * or a menu is open, and a click in another app closes the chat. When the user wants it hidden, the dock
 * slides into the edge while nobody uses it, and comes back when the pointer touches the edge. With the
 * edge strip on, only the pointer near the strip brings it back. With "show when an agent needs you" on,
 * it also comes out by itself, calmly: while an agent waits for the user, and for a short time after a
 * new reply. It does not take the focus then.
 */
export function AgentDockSurface() {
  const { t, errorMessage } = useText();
  const [presentation, setPresentation] = createSignal<AgentDockPresentation | null>(null);
  const [closeRequest, setCloseRequest] = createSignal(0);
  const [tucked, setTuckedSignal] = createSignal(false);
  /** The dock came out by itself, not under the pointer. */
  const [calmReveal, setCalmReveal] = createSignal(false);
  /** The seats that need the user, by seat key. */
  const [calling, setCallingSignal] = createSignal<readonly string[]>([]);
  /* A plain copy, read outside a tracking scope. */
  let callingKeys: readonly string[] = [];
  /* A plain copy: a signal write shows in a read only after the next flush. */
  let isTucked = false;
  const setTucked = (value: boolean) => {
    if (isTucked === value) return;
    isTucked = value;
    setTuckedSignal(value);
    syncShape();
  };
  let received = false;
  let chatOpen = false;
  let pointerIn = false;
  let dragging = false;
  /** The finished-work shelf shows results. */
  let shelfShown = false;
  /** A plain copy of the hide setting: the tuck timer and the pointer handlers read it outside a tracking scope. */
  let autoHide = false;
  /** A plain copy of the edge strip setting. */
  let edgeStrip = false;
  /** The pointer is close to the edge strip. */
  let near = false;
  /** A plain copy of the "show when an agent needs you" setting. */
  let peekOn = false;
  /** The seats that wait for the user, by seat key. */
  let waitingSeats: readonly string[] = [];
  /** The seats with a new reply that keep the dock out until `replyTimer` ends. */
  let replySeats = new Set<string>();
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  /** The last unread count of each agent seat, by seat key. A working or waiting mark hides the count. */
  let unreadCounts = new Map<string, number>();
  /** The server of the counts. The first presentation of a server only records them. */
  let countedServer: string | null = null;
  let tuckTimer: ReturnType<typeof setTimeout> | undefined;
  let sent = { interactive: false, keyboard: false };
  /** The dock parts at rest, or null while the dock moves. */
  let dockShape: readonly AgentDockShapeRect[] | null = null;
  let sentShape = "";
  /** A retry of a failed draft keeps its id, so the agent or the channel gets the message once. */
  let failed: { seatKey: string; text: string; clientMessageId: string } | null = null;

  const apply = (next: AgentDockPresentation | null) => {
    received = true;
    setPresentation(next);
  };

  const perform = (action: AgentDockAction) => agentDockPort().agentDock.performAction(action);

  const menuOpen = () => document.querySelector(".ui-action-menu") !== null;
  /** The user is on the dock or works with it. */
  const handsOn = () => pointerIn || near || chatOpen || dragging || menuOpen();
  /* A result on the shelf keeps the dock out like a use, but the dock comes out by itself for it. */
  const inUse = () => handsOn() || shelfShown;
  /** An agent needs the user, and the user wants the hidden dock to come out for it. */
  const wantsYou = () => autoHide && peekOn && (waitingSeats.length > 0 || replySeats.size > 0);
  const stopTuckTimer = () => {
    clearTimeout(tuckTimer);
    tuckTimer = undefined;
  };

  /** Slides the dock into the edge a moment after the use ends; a use in the meantime keeps it out. */
  const updateTuck = () => {
    if (!autoHide || inUse() || wantsYou()) {
      stopTuckTimer();
      if (isTucked) setCalmReveal(autoHide && !handsOn());
      setTucked(false);
      return;
    }
    if (isTucked || tuckTimer !== undefined) return;
    tuckTimer = setTimeout(() => {
      tuckTimer = undefined;
      if (autoHide && !inUse() && !wantsYou()) setTucked(true);
    }, TUCK_DELAY_MS);
  };
  /** Shows the dock now because the pointer came to the edge or the strip. */
  const revealByPointer = () => {
    stopTuckTimer();
    setCalmReveal(false);
    setTucked(false);
  };

  const stopReplyPeek = () => {
    clearTimeout(replyTimer);
    replyTimer = undefined;
    replySeats = new Set();
  };
  /**
   * Reads which seats need the user. A seat that waits keeps the dock out. A rise of an agent's unread
   * count is a new reply: it keeps the dock out for `REPLY_PEEK_MS`. A count that goes down (the user read
   * it), a working mark and the user's own message do not show the dock.
   */
  const noticeAttention = (next: AgentDockPresentation | null) => {
    if (!next) return;
    const first = next.serverId !== countedServer;
    countedServer = next.serverId;
    if (first) stopReplyPeek();
    const waiting: string[] = [];
    const counts = new Map<string, number>();
    let replied = false;
    for (const seat of next.seats) {
      const key = agentDockSeatKey(seatRefOf(seat));
      if (seat.state?.kind === "waiting") waiting.push(key);
      // A channel counts the messages of all its members, so its count does not mean a reply to the user.
      if (seat.kind !== "agent") continue;
      const before = unreadCounts.get(key);
      const state = seat.state;
      const count =
        state === null || state.kind === "responded" ? 0 : state.kind === "unread" ? state.count : (before ?? 0);
      counts.set(key, count);
      if (before === undefined) continue;
      if (count > before && !first && autoHide && peekOn) {
        replySeats.add(key);
        replied = true;
      } else if (count < before) replySeats.delete(key);
    }
    for (const key of replySeats) if (!counts.has(key)) replySeats.delete(key);
    unreadCounts = counts;
    waitingSeats = waiting;
    if (replied) {
      clearTimeout(replyTimer);
      replyTimer = setTimeout(() => {
        replyTimer = undefined;
        replySeats = new Set();
        showCalling();
        updateTuck();
      }, REPLY_PEEK_MS);
    }
    showCalling();
  };
  /** Marks the seats that need the user, while the dock can come out for them. */
  const showCalling = () => {
    const next = autoHide && peekOn ? [...new Set([...waitingSeats, ...replySeats])] : [];
    if (next.length === callingKeys.length && next.every((key, index) => key === callingKeys[index])) return;
    callingKeys = next;
    setCallingSignal(next);
  };
  createEffect(presentation, (value) => {
    autoHide = value?.autoHide ?? false;
    peekOn = value?.peekOnAttention ?? false;
    if (!autoHide || !peekOn) stopReplyPeek();
    noticeAttention(value);
    updateTuck();
  });
  createEffect(
    () => presentation()?.edgeStrip ?? false,
    (value) => {
      edgeStrip = value;
      syncShape();
    },
  );
  /** The strip shows only on a dock that hides. */
  const stripOn = () => (presentation()?.autoHide ?? false) && (presentation()?.edgeStrip ?? false);
  const asks = createMemo(() => (presentation()?.seats ?? []).some((seat) => seat.state?.kind === "waiting"));

  /**
   * Linux: tells main the parts of the window that take the pointer. The whole window while the dock
   * moves or a menu is open, so that nothing is cut off; the strip at the edge while the dock is hidden.
   * With the edge strip on, only the visible strip at rest takes the pointer: the pointer goes past it elsewhere.
   * Windows: tells main the same parts, with all of the strip and the distance where the strip feels the
   * pointer, as the zone that gets the pointer moves.
   */
  function syncShape() {
    if (!SHAPED_WINDOW && !POINTER_ZONE_WINDOW) return;
    const whole = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const parts = dockShape === null || menuOpen() ? [whole] : [...dockShape];
    if (isTucked) {
      const body = edgeStrip ? agentDockBody()?.getBoundingClientRect() : undefined;
      const width = body ? AGENT_DOCK_STRIP_WIDTH : EDGE_STRIP;
      const x = presentation()?.edge === "left" ? 0 : window.innerWidth - width;
      // The strip feels the pointer along all of the dock body.
      const rest = POINTER_ZONE_WINDOW ? 1 : AGENT_DOCK_STRIP_REST;
      parts.push(
        body
          ? {
              x,
              y: Math.round(body.top + (body.height * (1 - rest)) / 2),
              width,
              height: Math.round(body.height * rest),
            }
          : { x, y: 0, width, height: window.innerHeight },
      );
    }
    const feel = AGENT_DOCK_STRIP_FEEL;
    const shape = windowShape(
      POINTER_ZONE_WINDOW
        ? parts.map((part) => ({
            x: part.x - feel,
            y: part.y - feel,
            width: part.width + feel * 2,
            height: part.height + feel * 2,
          }))
        : parts,
    );
    const key = JSON.stringify(shape);
    if (key === sentShape) return;
    sentShape = key;
    void agentDockPort()
      .agentDock.setInputRegion(shape)
      .catch(() => undefined);
  }

  /** Tells main when the window takes the pointer and the keys. Only a change is sent. */
  const sync = () => {
    updateTuck();
    const next = { interactive: pointerIn, keyboard: chatOpen || menuOpen() };
    if (next.interactive === sent.interactive && next.keyboard === sent.keyboard) return;
    sent = next;
    void agentDockPort()
      .agentDock.setInteractive(next)
      .catch(() => undefined);
  };

  onSettled(() => {
    const unsubscribe = agentDockPort().agentDock.onPresentation(apply);
    // The dock on another display opened a chat. One chat is open at a time.
    const stopCloseChat = agentDockPort().agentDock.onCloseChat(() => setCloseRequest((value) => value + 1));
    void agentDockPort()
      .agentDock.getPresentation()
      .then((value) => {
        if (!received) apply(value);
      })
      .catch(() => undefined);

    // The dock shapes take the pointer; the empty page, the body and the root let it through.
    const onPointer = (event: MouseEvent) => {
      if (isTucked && !edgeStrip && atEdge(event)) revealByPointer();
      const target = event.target;
      pointerIn =
        target instanceof Element &&
        target !== document.documentElement &&
        target !== document.body &&
        target.id !== "root";
      sync();
    };
    const onLeave = () => {
      pointerIn = false;
      sync();
    };
    const onBlur = () => setCloseRequest((value) => value + 1);
    // A menu opens and closes in a portal on the body.
    const menus = new MutationObserver(() => {
      sync();
      syncShape();
    });
    menus.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role"] });
    document.addEventListener("mouseover", onPointer);
    document.addEventListener("mousemove", onPointer);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onBlur);
    return () => {
      unsubscribe();
      stopCloseChat();
      menus.disconnect();
      document.removeEventListener("mouseover", onPointer);
      document.removeEventListener("mousemove", onPointer);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onBlur);
      stopTuckTimer();
      stopReplyPeek();
    };
  });

  /** The pointer is on the strip at the screen edge that holds the dock. */
  const atEdge = (event: MouseEvent) =>
    presentation()?.edge === "left" ? event.clientX < EDGE_STRIP : event.clientX >= window.innerWidth - EDGE_STRIP;

  const seats = createMemo((): AgentDockSeat[] =>
    (presentation()?.seats ?? []).map(
      (seat): AgentDockSeat =>
        seat.kind === "agent"
          ? {
              kind: "agent",
              agent: seat.agent,
              mood: seat.mood,
              state: seat.state ?? undefined,
              temporary: seat.temporary,
            }
          : {
              kind: "channel",
              channel: uiChannel(seat.channel),
              state: seat.state ?? undefined,
              temporary: seat.temporary,
            },
    ),
  );
  const availableChannels = createMemo(() => (presentation()?.availableChannels ?? []).map(uiChannel));
  const chats = createMemo(() => {
    const bySeat = new Map<string, AgentDockChatModel>();
    for (const chat of presentation()?.chats ?? []) {
      const messages = chat.messages.map(
        (message): AgentMessage => ({
          id: message.id,
          author: message.author,
          ...(message.senderAgentId ? { senderAgentId: message.senderAgentId } : {}),
          ...(message.senderMember ? { senderMember: message.senderMember } : {}),
          kind: message.kind,
          body: message.body,
          time: "",
          attachments: message.attachments,
        }),
      );
      bySeat.set(agentDockSeatKey(chat.seat), { messages, working: chat.working, wait: chat.wait });
    }
    return bySeat;
  });
  const agents = createMemo(() => [...(presentation()?.agents ?? [])]);
  const results = createMemo(() => [...(presentation()?.results ?? [])]);
  const chat = (seat: AgentDockSeatRef): AgentDockChatModel =>
    chats().get(agentDockSeatKey(seat)) ?? { messages: [], working: false, wait: null };

  const serverId = createMemo(() => presentation()?.serverId ?? null);
  const voice = createAgentDockVoice(() => serverId() ?? "local");
  /* A dock of another server starts with no chat, shelf or drag: the old dock reports no end when it goes. */
  createEffect(serverId, () => {
    chatOpen = false;
    shelfShown = false;
    dragging = false;
    sync();
  });

  /* Each server has its own dock; a new presentation of the same server keeps the open chat. */
  return (
    <Show when={serverId()} keyed>
      {(server) => (
        <>
          <AgentDock
            seats={seats()}
            available={presentation()?.available ?? []}
            availableChannels={availableChannels()}
            chat={chat}
            closeRequest={closeRequest()}
            voice={voice}
            side={presentation()?.edge ?? "right"}
            tucked={tucked()}
            calmReveal={calmReveal()}
            calling={calling()}
            onShapeChange={
              SHAPED_WINDOW || POINTER_ZONE_WINDOW
                ? (parts) => {
                    dockShape = parts;
                    syncShape();
                  }
                : undefined
            }
            onDrag={(phase) => {
              dragging = phase !== "end";
              updateTuck();
              void agentDockPort()
                .agentDock.drag(phase)
                .catch(() => undefined);
            }}
            onOpenChange={(seat) => {
              chatOpen = seat !== null;
              sync();
              void perform({ type: "open-chat", serverId: server, seat: seat && contractSeat(seat) }).catch(
                () => undefined,
              );
            }}
            onAdd={(seat) =>
              void perform({ type: "add", serverId: server, seat: contractSeat(seat) }).catch(() => undefined)
            }
            onRemove={(seat) =>
              void perform({ type: "remove", serverId: server, seat: contractSeat(seat) }).catch(() => undefined)
            }
            onMove={async (seat, before) => {
              // A failed move puts the seats back in the dock.
              await perform({
                type: "move",
                serverId: server,
                seat: contractSeat(seat),
                before: before ? contractSeat(before) : null,
              });
            }}
            onSend={async (seat, text) => {
              const seatKey = agentDockSeatKey(seat);
              const clientMessageId =
                failed && failed.seatKey === seatKey && failed.text === text
                  ? failed.clientMessageId
                  : crypto.randomUUID();
              try {
                await perform({ type: "send", serverId: server, seat: contractSeat(seat), text, clientMessageId });
                failed = null;
                return { messageId: clientMessageId };
              } catch (error) {
                failed = { seatKey, text, clientMessageId };
                return { error: errorMessage(error, t("chat.errorStatus.send")) };
              }
            }}
            onOpenInMain={(seat) =>
              void perform(
                seat.kind === "channel"
                  ? { type: "open-channel", serverId: server, channelId: seat.id }
                  : { type: "open-agent", serverId: server, agentId: seat.id },
              ).catch(() => undefined)
            }
            onOpenWindow={(agentId) =>
              void perform({ type: "open-window", serverId: server, agentId }).catch(() => undefined)
            }
            agents={agents()}
            onSelectAgent={(agentId) =>
              void perform({ type: "open-agent", serverId: server, agentId }).catch(() => undefined)
            }
            onOpenLink={(url) => void perform({ type: "open-link", url }).catch(() => undefined)}
            onOpenSettings={() => void perform({ type: "open-settings" }).catch(() => undefined)}
            onHide={() => void perform({ type: "hide" }).catch(() => undefined)}
            results={results()}
            onShelfChange={(shown) => {
              // A result that came shows the hidden dock until the shelf is empty.
              shelfShown = shown;
              sync();
            }}
          />
          <Show when={stripOn()}>
            <AgentDockEdgeStrip
              side={presentation()?.edge ?? "right"}
              shown={tucked()}
              asks={asks()}
              onNearChange={(value) => {
                near = value;
                sync();
              }}
              onShow={revealByPointer}
            />
          </Show>
        </>
      )}
    </Show>
  );
}

/** The members of a channel as the shared channel avatar reads them. */
function uiChannel(channel: AgentDockChannel): AgentDockUiChannel {
  return { ...channel, members: channel.members.map((agentId) => ({ agentId })) };
}

/** The reference of a seat that the dock shows. */
function seatRefOf(seat: AgentDockPresentation["seats"][number]): AgentDockSeatRef {
  return seat.kind === "agent" ? { kind: "agent", id: seat.agent.id } : { kind: "channel", id: seat.channel.id };
}

/** A plain seat for the action: the dock state can hold a store copy. */
function contractSeat(seat: AgentDockSeatRef): AgentDockSeatContract {
  return seat.kind === "channel" ? { kind: "channel", id: seat.id } : { kind: "agent", id: seat.id };
}
