// Frozen optional remote-computer-use-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's desktop
// app tells the host that the agents of that member on the host may use Computer Use on the computer
// that the app runs on (`state`, with `available` and the computer's name). The app sends it only for
// a server that the user turned on in the app, and only while its own Computer Use has its grants. The
// host then gives a Computer Use tool for that computer to the agents that member manages, only while
// that member is the only enabled member of the server, and sends each tool request of those agents
// as a `remote-computer-call` event to the event connections of the session that sent `state`, and of
// no other session. The app runs the request on its own Computer Use driver and sends the answer to
// `reply`, from the same session. The host keeps the state in memory only, fails the waiting requests
// when the session has no event connection, and forgets the computer when the session sends
// `available: false` or does not send `state` again in time. Any member can
// send it. A host that cannot give tools to its agents does not advertise it. Widening any of it needs
// a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, boolean, empty, fields, identifier, type OptionalRouteCodec, string } from "./admin-wire";

export const REMOTE_COMPUTER_USE_CAPABILITY = "remote-computer-use-v1";

export const REMOTE_COMPUTER_USE_ROUTES = {
  state: "/v1/client/computer-use/state",
  reply: "/v1/client/computer-use/reply",
} as const;

/** The longest computer name, in UTF-16 units. */
export const REMOTE_COMPUTER_NAME_MAX_LENGTH = 64;
/**
 * The longest answer, in UTF-16 units. It keeps a reply inside the 1 MiB JSON body of an HTTPS host,
 * so the app makes a screenshot smaller before it sends the answer.
 */
export const REMOTE_COMPUTER_REPLY_MAX_LENGTH = 900_000;
/** The longest tool name in a request. */
export const REMOTE_COMPUTER_TOOL_MAX_LENGTH = 128;
/** The longest JSON text of the tool arguments in a request. */
export const REMOTE_COMPUTER_ARGUMENTS_MAX_LENGTH = 65_536;
/**
 * How often an app sends `state` while it is available. The host forgets a computer that sent nothing
 * for three intervals, so a computer that sleeps or loses the network stops being offered.
 */
export const REMOTE_COMPUTER_STATE_INTERVAL_MS = 30_000;

export const REMOTE_COMPUTER_USE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    REMOTE_COMPUTER_USE_ROUTES.state,
    adminRoute(fields({ available: boolean, computerName: string(REMOTE_COMPUTER_NAME_MAX_LENGTH) }), empty),
  ],
  [
    REMOTE_COMPUTER_USE_ROUTES.reply,
    // `ok: true`: `payload` is the JSON text of the MCP result. `ok: false`: it is an error sentence.
    adminRoute(
      fields({ requestId: identifier, ok: boolean, payload: string(REMOTE_COMPUTER_REPLY_MAX_LENGTH) }),
      empty,
    ),
  ],
]);

export const REMOTE_COMPUTER_CALL_EVENT = "remote-computer-call";

export type RemoteComputerCallEvent =
  | { type: typeof REMOTE_COMPUTER_CALL_EVENT; requestId: string; operation: "list-tools" }
  | {
      type: typeof REMOTE_COMPUTER_CALL_EVENT;
      requestId: string;
      operation: "call-tool";
      tool: string;
      /** The JSON text of an object. */
      arguments: string;
    };

/** Null for any other event. A malformed call throws, so the stream fails closed. */
export function remoteComputerCallEvent(value: unknown): RemoteComputerCallEvent | null {
  if (!isDynamicRecord(value) || value.type !== REMOTE_COMPUTER_CALL_EVENT) return null;
  const { requestId, operation } = value;
  if (!isString(requestId) || !requestId.length || requestId.length > 128)
    throw new Error("Invalid remote computer call.");
  if (operation === "list-tools") return { type: REMOTE_COMPUTER_CALL_EVENT, requestId, operation };
  const { tool, arguments: input } = value;
  if (
    operation !== "call-tool" ||
    !isString(tool) ||
    !tool.length ||
    tool.length > REMOTE_COMPUTER_TOOL_MAX_LENGTH ||
    !isString(input) ||
    input.length > REMOTE_COMPUTER_ARGUMENTS_MAX_LENGTH
  )
    throw new Error("Invalid remote computer call.");
  return { type: REMOTE_COMPUTER_CALL_EVENT, requestId, operation, tool, arguments: input };
}
