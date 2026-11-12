import type { AgentMessage } from "@openbot/ui/data";

/**
 * The newest finished reply of the agent: the text that ⇧⌘C copies. A reply that the agent still
 * writes, a step, a plan or a question is not one, as in ChatGPT.
 */
export function lastAgentReply(messages: readonly AgentMessage[]): AgentMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      message.author === "agent" &&
      (message.kind === undefined || message.kind === "text") &&
      !message.streaming &&
      message.body.trim() !== ""
    ) {
      return message;
    }
  }
  return undefined;
}

/** The text of the last fenced code block of a Markdown reply, without its fences, or undefined. */
export function lastCodeBlock(body: string): string | undefined {
  let last: string | undefined;
  for (const match of body.matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[`~]*[ \t]*$/gmu)) {
    last = match[2];
  }
  return last?.replace(/\n$/u, "");
}
