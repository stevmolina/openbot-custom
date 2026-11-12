// Frozen optional push-notifications-web-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's web
// client, installed or open in a browser, gives the host its standard Web Push subscription (RFC 8030)
// when it takes notifications: the push service endpoint and the `p256dh` and `auth` keys of the
// subscription, which only the browser and the host know, and the events the member wants to hear
// about. While the web client says it is away, the host sends a notification for each such event of
// an agent this member can see, through the OpenBot relay and the push service of the browser, as
// `push-notifications-android-v1` does for an Android phone. The host encrypts the title, the text and
// the path to open with the keys of the subscription (RFC 8291, `aes128gcm`), so the relay and the push
// service cannot read them. The relay checks that the session of the web client is still open on the
// account service before each send, and sends only to a known push service. A registration has no
// sound: the browser plays its own. The host keeps a registration for the session that sent it, also
// after it restarts, and forgets it when the web client removes it, when the member is removed or
// disabled, or when the relay or the push service refuses it. Widening any of it needs a second
// capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import type { PushNotificationLevel } from "./push-notifications-v1";

export const WEB_PUSH_NOTIFICATIONS_CAPABILITY = "push-notifications-web-v1";

export const WEB_PUSH_NOTIFICATIONS_ROUTES = {
  register: "/v1/push-notifications/web-registration",
  remove: "/v1/push-notifications/web-registration/remove",
} as const;

export interface WebPushNotificationRegistration {
  /** The web client's id for this host. The host puts it into the path that a click opens. */
  serverId: string;
  /** The push service URL of the subscription (`PushSubscription.endpoint`). Always `https:`. */
  endpoint: string;
  /** The P-256 public key of the subscription, 65 bytes uncompressed, as base64url. */
  p256dh: string;
  /** The authentication secret of the subscription, 16 bytes, as base64url. */
  auth: string;
  /** The interface language of the web client. The host uses English for a language it does not have. */
  locale: string;
  /** `true` while no window of the web client is on screen. Only then does the host send notifications. */
  away: boolean;
  level: PushNotificationLevel;
  /** No notification before this time, in seconds since 1970, or `null`. */
  mutedUntil: number | null;
  /** Whether the notification shows the start of a reply or a question, or only what happened. */
  preview: boolean;
}

/** The longest endpoint that a host keeps. Push services give URLs of a few hundred characters. */
export const WEB_PUSH_ENDPOINT_LIMIT = 2_048;
/** 65 bytes as base64url without padding. An uncompressed point starts with 0x04, which is `B`. */
export const WEB_PUSH_P256DH_PATTERN = /^B[A-Za-z0-9_-]{86}$/u;
/** 16 bytes as base64url without padding. */
export const WEB_PUSH_AUTH_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

/** Whether `value` is an `https:` URL of at most `WEB_PUSH_ENDPOINT_LIMIT` characters, without credentials. */
export function isWebPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > WEB_PUSH_ENDPOINT_LIMIT) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "";
}

const pattern =
  (expression: RegExp, maximum: number): AdminDecoder =>
  (value) => {
    const text = string(maximum)(value);
    if (typeof text !== "string" || !expression.test(text)) throw new Error("Invalid push notification value.");
    return text;
  };

const endpoint: AdminDecoder = (value) => {
  if (!isWebPushEndpoint(value)) throw new Error("Invalid push notification value.");
  return value;
};

export const WEB_PUSH_NOTIFICATIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WEB_PUSH_NOTIFICATIONS_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        endpoint,
        p256dh: pattern(WEB_PUSH_P256DH_PATTERN, 87),
        auth: pattern(WEB_PUSH_AUTH_PATTERN, 22),
        locale: string(35),
        away: boolean,
        level: oneOf("all", "needs-me"),
        mutedUntil: nullable(count),
        preview: boolean,
      }),
      empty,
    ),
  ],
  [WEB_PUSH_NOTIFICATIONS_ROUTES.remove, adminRoute(empty, empty)],
]);
