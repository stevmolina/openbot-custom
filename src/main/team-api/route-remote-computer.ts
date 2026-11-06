import {
  REMOTE_COMPUTER_USE_CAPABILITY,
  REMOTE_COMPUTER_USE_ROUTES,
} from "@openbot/contracts/team-protocol/remote-computer-use-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RemoteComputerHost } from "../remote-computer-host";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * A member's desktop app offers its computer to the agents of that member, or answers one of their
 * tool requests. Frozen by `remote-computer-use-v1`; only a host that gives tools to its agents serves
 * it. Both routes act for the session of the request only, so one app cannot answer for another.
 */
export async function routeRemoteComputer(
  context: TeamApiRequestContext,
  computers: Pick<RemoteComputerHost, "setState" | "reply"> | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (method !== "POST") return "unmatched";
  if (url.pathname !== REMOTE_COMPUTER_USE_ROUTES.state && url.pathname !== REMOTE_COMPUTER_USE_ROUTES.reply)
    return "unmatched";
  if (!computers || !capabilities.has(REMOTE_COMPUTER_USE_CAPABILITY)) return "unmatched";
  // `readJson` has already run the body through the remote-computer-use wire codec.
  const body = await readJson(request);
  if (url.pathname === REMOTE_COMPUTER_USE_ROUTES.state) {
    const { available, computerName } = body;
    if (typeof available !== "boolean" || typeof computerName !== "string") return "unmatched";
    await runCauseEffect(computers.setState(member.id, sessionId, { available, computerName }));
    return json(200, {});
  }
  const { requestId, ok, payload } = body;
  if (typeof requestId !== "string" || typeof ok !== "boolean" || typeof payload !== "string") return "unmatched";
  if (!computers.reply(member.id, sessionId, { requestId, ok, payload }))
    throw new HttpError(404, sourceText("error.team.remoteComputerCallNotFound"));
  return json(200, {});
}
