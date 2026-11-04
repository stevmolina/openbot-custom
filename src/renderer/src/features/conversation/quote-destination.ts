import { fileQuoteTarget } from "@openbot/contracts/chat-tag-references";

/** The box that should receive a selected passage. */
export type QuoteDestination = { kind: "main" } | { kind: "open" } | { kind: "side"; threadId: string };

/** The thread lists `destinationForQuote` reads. The open thread is null for a new thread with no messages. */
export interface QuoteDestinationThreads {
  open: unknown;
  conversation?: { messages: readonly { id: string }[] } | undefined;
  side: {
    tabs: readonly { id: string }[];
    thread: (id: string) => { conversation?: { messages: readonly { id: string }[] } | undefined } | undefined;
  };
}

/** A selected passage goes to the thread that shows it. The agent's own chat takes the rest. */
export function destinationForQuote(threads: QuoteDestinationThreads | undefined, messageId: string): QuoteDestination {
  if (!threads) return { kind: "main" };
  const hasMessage = (ids: readonly { id: string }[] | undefined) =>
    ids?.some((message) => message.id === messageId) === true;
  // `open` is null for a new thread that has no messages yet, and undefined while the agent's own chat is open.
  if (threads.open !== undefined && hasMessage(threads.conversation?.messages)) return { kind: "open" };
  for (const tab of threads.side.tabs) {
    if (hasMessage(threads.side.thread(tab.id)?.conversation?.messages)) return { kind: "side", threadId: tab.id };
  }
  // A file passage has no message. While a thread covers the chat, the passage goes in that thread's box.
  if (threads.open !== undefined && fileQuoteTarget(messageId)) return { kind: "open" };
  return { kind: "main" };
}
