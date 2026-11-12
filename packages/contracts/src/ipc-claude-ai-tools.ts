/**
 * Whether the Claude agents of this computer get the claude.ai tools of the Claude Code sign-in:
 * the Artifact tools, which publish pages to the user's claude.ai account, and the claude.ai
 * connectors (Gmail, Notion, Slack and the others in the user's claude.ai connector settings).
 * They need a claude.ai sign-in and add about 13k tokens to each request.
 */

import { isBoolean, isDynamicRecord } from "./runtime-values";

export interface ClaudeAiToolsSetting {
  enabled: boolean;
}

/** Off, so that each turn sends the shorter prompt and no agent reaches the claude.ai account. */
export const DEFAULT_CLAUDE_AI_TOOLS: ClaudeAiToolsSetting = { enabled: false };

export function decodeClaudeAiToolsSetting(value: unknown): ClaudeAiToolsSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid claude.ai tools setting.");
  return { enabled: value.enabled };
}
