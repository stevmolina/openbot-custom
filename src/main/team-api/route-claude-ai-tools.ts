import {
  CLAUDE_AI_TOOLS_CAPABILITY,
  CLAUDE_AI_TOOLS_ROUTES,
} from "@openbot/contracts/team-protocol/claude-ai-tools-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * "Use claude.ai tools" of this server, read and set from a joined server. Only the switch leaves the
 * host, never a connector, a token or an artifact. Frozen by `claude-ai-tools-v1`.
 */
export async function routeClaudeAiTools(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CLAUDE_AI_TOOLS_ROUTES.settings && url.pathname !== CLAUDE_AI_TOOLS_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.claudeAiTools;
  if (!setting || !capabilities.has(CLAUDE_AI_TOOLS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.claudeAiToolsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the claude-ai-tools wire codec.
  const body = await readJson(request);
  if (url.pathname === CLAUDE_AI_TOOLS_ROUTES.settings) return json(200, setting.get());
  return json(200, await runCauseEffect(setting.set(body.enabled === true)));
}
