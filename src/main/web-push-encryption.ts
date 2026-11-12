import { createCipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import {
  WEB_PUSH_AUTH_PATTERN,
  WEB_PUSH_P256DH_PATTERN,
} from "@openbot/contracts/team-protocol/push-notifications-web-v1";

/**
 * Encrypts a Web Push message for one subscription, as RFC 8291 says, with the `aes128gcm` content
 * coding of RFC 8188 in one record. Only the browser that holds the private key of `p256dh` and the
 * `auth` secret can read it, so neither the OpenBot account service nor the push service can.
 *
 * The body is the header (salt, record size, the sender's public key) and one encrypted record. The
 * sender key is new for each message, as the RFC asks.
 */

/** The record size in the header. One record holds the whole message. */
const RECORD_SIZE = 4_096;
const SALT_BYTES = 16;
const PUBLIC_KEY_BYTES = 65;
const AUTH_BYTES = 16;
const TAG_BYTES = 16;
/** Salt, record size, key id length and key id. */
export const WEB_PUSH_HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES;

export interface WebPushSubscriptionKeys {
  /** The P-256 public key of the subscription, 65 bytes uncompressed, base64url. */
  p256dh: string;
  /** The authentication secret of the subscription, 16 bytes, base64url. */
  auth: string;
}

/** A test can fix the values that are random in each message, to compare with the RFC example. */
export interface WebPushEncryptionInputs {
  salt?: Uint8Array;
  senderPrivateKey?: Uint8Array;
}

/** The keys of a subscription as bytes, or `null` when they are not a P-256 point and a 16-byte secret. */
export function decodeWebPushKeys(keys: WebPushSubscriptionKeys): { publicKey: Buffer; auth: Buffer } | null {
  if (!WEB_PUSH_P256DH_PATTERN.test(keys.p256dh) || !WEB_PUSH_AUTH_PATTERN.test(keys.auth)) return null;
  const publicKey = Buffer.from(keys.p256dh, "base64url");
  const auth = Buffer.from(keys.auth, "base64url");
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 0x04 || auth.length !== AUTH_BYTES) return null;
  // A key that is not on the curve fails here, not at the first message.
  try {
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(publicKey);
  } catch {
    return null;
  }
  return { publicKey, auth };
}

/** The largest plaintext that fits one record and the 4096-byte limit of push services with its header. */
export const WEB_PUSH_PLAINTEXT_LIMIT = RECORD_SIZE - WEB_PUSH_HEADER_BYTES - TAG_BYTES - 1;

/**
 * The `aes128gcm` body for `plaintext`, or `null` when the keys are not valid or the plaintext is longer
 * than `WEB_PUSH_PLAINTEXT_LIMIT`.
 */
export function encryptWebPush(
  plaintext: Uint8Array,
  keys: WebPushSubscriptionKeys,
  inputs: WebPushEncryptionInputs = {},
): Uint8Array | null {
  if (plaintext.length > WEB_PUSH_PLAINTEXT_LIMIT) return null;
  const decoded = decodeWebPushKeys(keys);
  if (!decoded) return null;
  const sender = createECDH("prime256v1");
  if (inputs.senderPrivateKey) sender.setPrivateKey(Buffer.from(inputs.senderPrivateKey));
  else sender.generateKeys();
  const senderPublicKey = sender.getPublicKey();
  let sharedSecret: Buffer;
  try {
    sharedSecret = sender.computeSecret(decoded.publicKey);
  } catch {
    return null;
  }
  // RFC 8291 section 3.4: the input key of the content coding comes from the shared secret, the
  // authentication secret, and both public keys.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), decoded.publicKey, senderPublicKey]);
  const inputKey = hkdf(decoded.auth, sharedSecret, keyInfo, 32);
  const salt = Buffer.from(inputs.salt ?? randomBytes(SALT_BYTES));
  // RFC 8188 section 2.2 and 2.3.
  const contentKey = hkdf(salt, inputKey, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, inputKey, Buffer.from("Content-Encoding: nonce\0"), 12);
  // One record, so it is the last one: the delimiter is 0x02, with no padding after it.
  const record = Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(WEB_PUSH_HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header.writeUInt8(PUBLIC_KEY_BYTES, SALT_BYTES + 4);
  senderPublicKey.copy(header, SALT_BYTES + 5);
  return new Uint8Array(Buffer.concat([header, encrypted]));
}

/** HKDF with SHA-256 (RFC 5869) for an output of at most 32 bytes: one expand block. */
function hkdf(salt: Uint8Array, inputKey: Uint8Array, info: Uint8Array, length: number): Buffer {
  const pseudoRandomKey = createHmac("sha256", salt).update(inputKey).digest();
  return createHmac("sha256", pseudoRandomKey)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}
