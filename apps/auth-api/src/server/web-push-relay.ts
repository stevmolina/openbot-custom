import {
  WEB_NOTIFICATION_BODY_LIMIT,
  WEB_NOTIFICATION_TOPIC_PATTERN,
  WEB_NOTIFICATION_TTL_LIMIT,
  WEB_NOTIFICATION_URGENCIES,
  type WebNotificationRelayPush,
  type WebNotificationUrgency,
} from "@openbot/contracts/notification-relay";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isWebPushEndpoint, WEB_PUSH_ENDPOINT_LIMIT } from "@openbot/contracts/team-protocol/push-notifications-web-v1";
import { Effect, Schema } from "effect";
import { importJWK, type JWK, SignJWT } from "jose";

/**
 * Forwards an encrypted Web Push notification from a host to the push service of a browser (RFC 8030),
 * signed with the VAPID key of this service (RFC 8292). The host encrypted the body for the browser's
 * subscription (RFC 8291), so this service cannot read it. It stores nothing and logs nothing: the
 * endpoint, the host and the bytes live only for the request.
 *
 * It sends only to the push services of the browsers that the web client supports, so a host
 * credential cannot make this service post to any other address.
 */

/** The VAPID key pair and contact of this service. */
export interface WebPushVapidConfig {
  /** The private key as a JWK of an EC P-256 key with `d`. */
  privateKey: JWK;
  /** The public key, 65 bytes uncompressed, as base64url. Browsers subscribe with it. */
  publicKey: string;
  /** A `mailto:` or `https:` contact that push services can use (RFC 8292 section 2.1). */
  subject: string;
}

export type WebPushRelayResult = "sent" | "gone" | "rejected" | "unavailable";

/** RFC 8292 section 2: at most 24 hours. 12 hours leaves room for clock differences. */
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
/** A new token is made this long before the old one ends. */
const TOKEN_MARGIN_SECONDS = 60 * 60;
/** The tokens kept, one for each push service. */
const TOKEN_CACHE_LIMIT = 16;
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * The hosts of the push services of Chrome and Edge on Android and desktop (Firebase), Firefox
 * (Mozilla autopush), Safari (Apple) and Edge on Windows (Windows Notification Service).
 */
const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/u,
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/u,
  /^web\.push\.apple\.com$/u,
  /^(?:[a-z0-9-]+\.)+notify\.windows\.com$/u,
];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

class WebPushProviderError extends Schema.TaggedError<WebPushProviderError>()("WebPushProviderError", {}) {}

/**
 * Whether this service sends to `endpoint`: an `https:` URL of a known push service on the default
 * port. With `allowLoopback`, which only `vite dev` sets, an `http:` URL on this computer also passes,
 * so a local check can stand in for a push service.
 */
export function webPushEndpointAllowed(endpoint: string, allowLoopback: boolean): boolean {
  if (endpoint.length > WEB_PUSH_ENDPOINT_LIMIT) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (allowLoopback && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.username) return true;
  if (!isWebPushEndpoint(endpoint) || url.port !== "") return false;
  return PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

export class WebPushRelaySender {
  readonly #config: WebPushVapidConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #key: Awaited<ReturnType<typeof importJWK>> | null = null;
  /** One token for each push service origin, as the audience of a token is that origin. */
  readonly #tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(config: WebPushVapidConfig, fetch: Fetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetch;
    this.#now = now;
  }

  get publicKey(): string {
    return this.#config.publicKey;
  }

  readonly sendNotification = Effect.fn("WebPushRelaySender.sendNotification")(function* (
    this: WebPushRelaySender,
    push: WebNotificationRelayPush,
  ): Effect.fn.Return<WebPushRelayResult> {
    const origin = new URL(push.endpoint).origin;
    const token = yield* this.#token(origin).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!token) return "unavailable";
    const headers: Record<string, string> = {
      authorization: `vapid t=${token}, k=${this.#config.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(push.ttl),
      urgency: push.urgency,
    };
    if (push.topic) headers.topic = push.topic;
    const body = base64UrlBytes(push.body);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(push.endpoint, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        }),
      catch: () => new WebPushProviderError({}),
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response) return "unavailable";
    // The answer has nothing that this service needs. Reading it frees the connection.
    yield* Effect.tryPromise({ try: () => response.arrayBuffer(), catch: () => new WebPushProviderError({}) }).pipe(
      Effect.ignore,
    );
    return relayResult(response.status);
  }).bind(this);

  /** Only resolved values cross Worker requests; pending I/O remains with its invocation. */
  readonly #token = Effect.fn("WebPushRelaySender.token")(function* (
    this: WebPushRelaySender,
    audience: string,
  ): Effect.fn.Return<string, WebPushProviderError> {
    const now = Math.floor(this.#now() / 1000);
    const cached = this.#tokens.get(audience);
    if (cached && now < cached.expiresAt - TOKEN_MARGIN_SECONDS) return cached.value;
    this.#key ??= yield* Effect.tryPromise({
      try: () => importJWK(this.#config.privateKey, "ES256"),
      catch: () => new WebPushProviderError({}),
    });
    const key = this.#key;
    const expiresAt = now + TOKEN_LIFETIME_SECONDS;
    const value = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({})
          .setProtectedHeader({ alg: "ES256", typ: "JWT" })
          .setAudience(audience)
          .setSubject(this.#config.subject)
          .setExpirationTime(expiresAt)
          .sign(key),
      catch: () => new WebPushProviderError({}),
    });
    if (!cached && this.#tokens.size >= TOKEN_CACHE_LIMIT) {
      const oldest = this.#tokens.keys().next().value;
      if (oldest !== undefined) this.#tokens.delete(oldest);
    }
    this.#tokens.set(audience, { value, expiresAt });
    return value;
  });
}

/**
 * RFC 8030 section 5: 201 is the answer for a stored message, and some services give 200 or 202. A
 * subscription that ended answers 404 or 410. A body that is too large answers 413.
 */
export function relayResult(status: number): WebPushRelayResult {
  if (status === 200 || status === 201 || status === 202) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "unavailable";
  return "rejected";
}

/**
 * Reads one notification from a host request body, or returns `null` when it is not valid or its
 * endpoint is not a known push service.
 */
export function readWebNotificationRelayPush(
  body: DynamicRecord,
  allowLoopback: boolean,
): WebNotificationRelayPush | null {
  const { endpoint, sessionId, body: encrypted, ttl, urgency, topic, timestamp } = body;
  if (!isString(endpoint) || !webPushEndpointAllowed(endpoint, allowLoopback)) return null;
  if (!isString(sessionId) || !sessionId || sessionId.length > 128) return null;
  if (!isString(encrypted) || !/^[A-Za-z0-9_-]+$/u.test(encrypted)) return null;
  // The header alone has 86 bytes, and a record has at least the delimiter and the tag.
  const size = base64UrlSize(encrypted);
  if (size === null || size < 86 + 17 || size > WEB_NOTIFICATION_BODY_LIMIT) return null;
  if (typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl < 0 || ttl > WEB_NOTIFICATION_TTL_LIMIT) return null;
  if (!isUrgency(urgency)) return null;
  if (topic !== undefined && (!isString(topic) || !WEB_NOTIFICATION_TOPIC_PATTERN.test(topic))) return null;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return {
    endpoint,
    sessionId,
    body: encrypted,
    ttl,
    urgency,
    ...(topic === undefined ? {} : { topic }),
    timestamp,
  };
}

function isUrgency(value: unknown): value is WebNotificationUrgency {
  return WEB_NOTIFICATION_URGENCIES.some((urgency) => urgency === value);
}

/** The decoded size of unpadded base64url text, or `null` for a length that no byte string has. */
function base64UrlSize(text: string): number | null {
  if (text.length % 4 === 1) return null;
  return Math.floor((text.length * 3) / 4);
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Reads the VAPID configuration from the Worker secrets, or returns `null` when one is missing or they
 * do not form one P-256 key pair and a contact.
 */
export function readWebPushVapidConfig(values: {
  privateKey: string | undefined;
  publicKey: string | undefined;
  subject: string | undefined;
}): WebPushVapidConfig | null {
  const { privateKey, publicKey, subject } = values;
  if (!privateKey || !publicKey || !subject) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(privateKey);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.kty !== "EC" || parsed.crv !== "P-256") return null;
  const { x, y, d } = parsed;
  if (!isString(x) || !isString(y) || !isString(d)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(x) || !/^[A-Za-z0-9_-]{43}$/u.test(y) || !/^[A-Za-z0-9_-]{43}$/u.test(d))
    return null;
  // The public key must be the key of the private key, or no browser could check a token.
  const point = new Uint8Array([0x04, ...base64UrlBytes(x), ...base64UrlBytes(y)]);
  if (publicKey !== bytesToBase64Url(point)) return null;
  if (!isVapidSubject(subject)) return null;
  return { privateKey: { kty: "EC", crv: "P-256", x, y, d }, publicKey, subject };
}

function isVapidSubject(value: string): boolean {
  if (value.length > 256) return false;
  if (/^mailto:[^\s@]+@[^\s@]+$/u.test(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

let shared: { key: string; sender: WebPushRelaySender } | null = null;

/** One sender for each key, so the key import and the tokens are reused. `null` without a valid configuration. */
export function sharedWebPushSender(values: {
  privateKey: string | undefined;
  publicKey: string | undefined;
  subject: string | undefined;
}): WebPushRelaySender | null {
  const key = `${values.privateKey}\n${values.publicKey}\n${values.subject}`;
  if (shared?.key === key) return shared.sender;
  const config = readWebPushVapidConfig(values);
  if (!config) return null;
  const sender = new WebPushRelaySender(config, (input, init) => fetch(input, init));
  shared = { key, sender };
  return sender;
}

/** What `relayWebNotification` needs from the Worker. A check stands in for each with the same answers. */
/** Each check fails with the error of its own service; the route maps every one to an answer. */
export interface WebNotificationRelayDependencies<E = unknown> {
  /** `null` while the Worker has no VAPID key pair or no limiter. */
  relay: {
    sender: Pick<WebPushRelaySender, "sendNotification">;
    allowLoopback: boolean;
    allowNotification(hostId: string): Effect.Effect<boolean, E>;
  } | null;
  /** Fails when the credential is not the host's. */
  authenticateHost(hostId: string, machineToken: string): Effect.Effect<unknown, E>;
  sessionOpen(hostId: string, sessionId: string): Effect.Effect<boolean, E>;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

/**
 * The answer to one host request of `POST /v2/remote/hosts/:hostId/web-notification`: the body is
 * checked before the credential, so an endpoint that is not a known push service never costs a lookup.
 */
export function relayWebNotification(
  hostId: string,
  body: DynamicRecord,
  dependencies: WebNotificationRelayDependencies,
): Effect.Effect<Response, unknown> {
  return Effect.gen(function* () {
    const { relay } = dependencies;
    if (!isString(body.machineToken))
      return errorResponse(400, "invalid_remote_request", "The host credential is invalid.");
    const push = readWebNotificationRelayPush(body, relay?.allowLoopback ?? false);
    if (!push) return errorResponse(400, "invalid_notification", "The notification is invalid.");
    yield* dependencies.authenticateHost(hostId, body.machineToken);
    if (!relay) return errorResponse(503, "notification_unavailable", "Notifications are not available.");
    if (!(yield* relay.allowNotification(hostId))) return errorResponse(429, "rate_limited", "Too many notifications.");
    // A host does not learn when the account service ends a session, so it asks for each one.
    if (!(yield* dependencies.sessionOpen(hostId, push.sessionId))) {
      return errorResponse(410, "notification_gone", "The web client no longer receives notifications.");
    }
    switch (yield* relay.sender.sendNotification(push)) {
      case "sent":
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      case "gone":
        return errorResponse(410, "notification_gone", "The web client no longer receives notifications.");
      case "rejected":
        return errorResponse(400, "notification_rejected", "The push service refused the notification.");
      case "unavailable":
        return errorResponse(503, "notification_unavailable", "The push service did not accept the notification now.");
    }
  });
}
