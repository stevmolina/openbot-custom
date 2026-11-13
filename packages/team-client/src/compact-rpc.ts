// The client half of compact-rpc-v1 (`@openbot/contracts/team-protocol/compact-rpc-v1`): request
// capability lists by key, and compressed response bodies.
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol";
import { TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES } from "@openbot/contracts/team-protocol/v2";
import { base64UrlToBytes } from "./base64";

/** A runtime without `DecompressionStream`, such as React Native, asks for no compressed body. */
export function canInflateResponses(): boolean {
  return typeof DecompressionStream === "function" && typeof Blob === "function";
}

/** The key of the capability list that a request of `protocol` sends. Undefined is the bootstrap list. */
export function capabilityListKey(protocol: number | undefined): string {
  return `p${protocol ?? 0}`;
}

/** The JSON body of a compressed result. A body above the JSON frame limit fails. */
export async function inflateRpcBody(deflated: string): Promise<TeamProtocolV2Json> {
  const bytes = base64UrlToBytes(deflated);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES) {
      await reader.cancel();
      throw new Error("The host sent a compressed body above the protocol limit.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeTeamProtocolV2Json(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)));
}
