import { AGENT_COMPUTER_KEY_INPUT_LIMIT } from "@openbot/contracts/ipc";
import { AGENT_COMPUTER_CAPABILITY, AGENT_COMPUTER_ROUTES } from "@openbot/contracts/team-protocol/agent-computer-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentComputer } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(AGENT_COMPUTER_ROUTES));

/**
 * The Agent Computer account of this host, which an owner or administrator connects from their own
 * computer with an API key. Frozen by `agent-computer-v1`. The key arrives once, in the connect body;
 * no answer carries it. `requireAdmin` runs on every route.
 */
export async function routeAgentComputer(
  context: TeamApiRequestContext,
  agentComputer: TeamApiAgentComputer | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!agentComputer || !capabilities.has(AGENT_COMPUTER_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `agent-computer-v1` codec.
  const body = await readJson(request);
  switch (url.pathname) {
    case AGENT_COMPUTER_ROUTES.connect: {
      const apiKey = stringField(body, "apiKey", false, AGENT_COMPUTER_KEY_INPUT_LIMIT).trim();
      registerSecretValue(apiKey);
      return json(200, await runCauseEffect(agentComputer.connect(apiKey)));
    }
    case AGENT_COMPUTER_ROUTES.test:
      return json(200, await runCauseEffect(agentComputer.test()));
    case AGENT_COMPUTER_ROUTES.disconnect:
      return json(200, await runCauseEffect(agentComputer.disconnect()));
    case AGENT_COMPUTER_ROUTES.machines:
      return json(200, await runCauseEffect(agentComputer.machines()));
    default:
      return json(200, agentComputer.status());
  }
}
