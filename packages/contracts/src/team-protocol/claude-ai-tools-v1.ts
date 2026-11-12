// Frozen optional claude-ai-tools-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set "Use claude.ai tools" of the host. On, the Claude agents of that server
// get the Artifact tools and the claude.ai connectors of the host's Claude Code sign-in, so they can
// publish pages to that claude.ai account and use its connectors. Off, they get neither. The routes
// carry only the switch, never a connector, a token or an artifact. The change applies to the Claude
// processes that start after it. A member cannot use either route; `requireAdmin` on the host is the
// only gate. Widening any of it needs a second capability string.
import type { ClaudeAiToolsSetting } from "../ipc-claude-ai-tools";
import { isBoolean, isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const CLAUDE_AI_TOOLS_CAPABILITY = "claude-ai-tools-v1";

export const CLAUDE_AI_TOOLS_ROUTES = {
  settings: "/v1/admin/host/claude-ai-tools",
  update: "/v1/admin/host/claude-ai-tools/update",
} as const;

const snapshot = fields({ enabled: boolean });

export const CLAUDE_AI_TOOLS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CLAUDE_AI_TOOLS_ROUTES.settings, adminRoute(empty, snapshot)],
  [CLAUDE_AI_TOOLS_ROUTES.update, adminRoute(snapshot, snapshot)],
]);

/**
 * The setting that a host answers, as the client type. It is not the preload decoder: the two check
 * different senders.
 */
export function decodeClaudeAiToolsResponse(value: unknown): ClaudeAiToolsSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid claude.ai tools setting.");
  return { enabled: value.enabled };
}
