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

/**
 * The text of the last fenced code block of a Markdown reply, without its fences, or undefined. A
 * fence can be indented, as under a list item; its indent is taken off each line. An empty block
 * counts as no block.
 */
export function lastCodeBlock(body: string): string | undefined {
  let last: string | undefined;
  const text = body.replace(/\r\n?/gu, "\n");
  for (const match of text.matchAll(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\2[`~]*[ \t]*$/gmu)) {
    const indent = match[1] ?? "";
    const lines = (match[3] ?? "").replace(/\n$/u, "").split("\n");
    const code = lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)).join("\n");
    if (code.trim() !== "") last = code;
  }
  return last;
}
