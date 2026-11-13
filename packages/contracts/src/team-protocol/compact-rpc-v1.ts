// Frozen optional compact-rpc-v1 wire contract, for the WebRTC RPC channel of Team protocol v2.
//
// What it grants, recorded here because freezing it makes it permanent. A host that advertises it:
//
// - Keeps each capability list that a request names with `capabilitiesKey`, for the life of the data
//   channel connection. A later request on the same connection can send that key with no
//   `capabilities` list, and the host reads it as the kept list. A key the host does not keep is a
//   `capabilities_unknown` error (409); the host never reads a missing list as an empty one.
// - Compresses the body of a response when the request sets `compressResponse: true` and the JSON
//   body is longer than `COMPACT_RPC_MIN_COMPRESSED_BYTES`. The result is then
//   `{ status, body: null, deflated }`: `deflated` is the JSON text of the body, deflated with raw
//   DEFLATE (RFC 1951) and encoded as base64url. A file result is never compressed.
// - Reads RPC and event frames that arrive after `auth-complete` and before it sends
//   `auth-confirmed`. It handles them after the session opens, and sends `auth-confirmed` before any
//   other RPC frame, so the client can send its first requests with `auth-complete`.
//
// A client uses the first two only on a connection to a host that advertised the capability. Bounds
// and meaning do not follow IPC changes; widening any of it needs a second capability string.
import { isDynamicRecord, isNumber, isString } from "../runtime-values";

export const COMPACT_RPC_CAPABILITY = "compact-rpc-v1";
/** A body below this many bytes of JSON text goes uncompressed: compression would save little. */
export const COMPACT_RPC_MIN_COMPRESSED_BYTES = 1_024;
/** Keys are short, so that a request without its list stays small. */
export const COMPACT_RPC_MAX_KEY_LENGTH = 32;
/** The kept lists of one connection. A client uses one for each protocol it reads. */
export const COMPACT_RPC_MAX_KEPT_LISTS = 8;
export const COMPACT_RPC_UNKNOWN_KEY_CODE = "capabilities_unknown";

export function isCompactRpcKey(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= COMPACT_RPC_MAX_KEY_LENGTH && /^[\w.-]+$/u.test(value);
}

/** A compressed RPC result, or null for any other result. */
export function compressedRpcResult(value: unknown): { status: number; deflated: string } | null {
  if (!isDynamicRecord(value) || !isNumber(value.status) || !isString(value.deflated) || value.body !== null)
    return null;
  if (!/^[\w-]*$/u.test(value.deflated)) return null;
  return { status: value.status, deflated: value.deflated };
}
