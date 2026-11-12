// Frozen optional artifact-request-v1 contract.
// A member with chat access can send one request with claude.ai Artifact tools, using the host's
// Claude sign-in. The tools can publish to claude.ai. Connectors stay off unless the host enabled
// its global setting. The host persists this choice for queued work and continuations. It never
// applies to the next ordinary request. The optional taskId selects an existing side thread.
import { type AdminDecoder, fields, identifier, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const ARTIFACT_REQUEST_CAPABILITY = "artifact-request-v1";
export const ARTIFACT_REQUEST_ROUTE = "/v1/artifact-requests/send";
const timezone: AdminDecoder = (value) => {
  const decoded = string(128)(value);
  if (typeof decoded !== "string") throw new Error("Invalid message timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: decoded });
  } catch {
    throw new Error("Invalid message timezone.");
  }
  return decoded;
};
const receipt = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.send)?.response;
if (!receipt) throw new Error("Missing task receipt codec.");
export const ARTIFACT_REQUEST_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    ARTIFACT_REQUEST_ROUTE,
    {
      request: fields(
        { agentId: identifier, text: string(100_000), attachmentDraftIds: list(identifier, 10) },
        {
          taskId: identifier,
          replyToMessageId: nullable(identifier),
          clientMessageId: identifier,
          timezone,
        },
      ),
      response: receipt,
    },
  ],
]);
