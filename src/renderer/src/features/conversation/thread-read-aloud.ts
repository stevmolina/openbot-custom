import type { AgentMessage } from "@openbot/ui/data";
import { speechModelReady } from "../speech/speech-model";
import { speechReading } from "../speech/speech-playback";
import { toggleReadAloud } from "../speech/speech-replies";

/** An agent reply in a thread can be read aloud, as in the agent's own chat. */
export function threadReadAloud(
  runtime: boolean,
  serverId: string,
  agentId: string | undefined,
  message: AgentMessage,
): { reading: boolean; onToggle: () => void } | undefined {
  if (runtime || !agentId || message.author !== "agent" || message.streaming || !message.body.trim()) return;
  if (!speechModelReady()) return;
  return {
    reading: speechReading()?.messageId === message.id,
    onToggle: () => toggleReadAloud({ serverId, agentId, messageId: message.id }, message.body),
  };
}
