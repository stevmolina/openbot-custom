import {
  PUSH_NOTIFICATION_THREADS_CAPABILITY,
  PUSH_NOTIFICATION_THREADS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import {
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import {
  PUSH_NOTIFICATIONS_CAPABILITY,
  PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import {
  WEB_PUSH_NOTIFICATIONS_CAPABILITY,
  WEB_PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-web-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  type PushTarget,
  readAndroidPushRegistration,
  readPushRegistration,
  readWebPushRegistration,
} from "../push-notification-store";
import type { PushNotificationService } from "../push-notifications";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The phone of the calling member gives or removes its push token and the events it wants. The host
 * sends notifications only for what this member can see. Frozen by `push-notifications-v1` for an
 * iPhone, by `push-notifications-android-v1` for an Android phone, and by `push-notifications-web-v1`
 * for a web client, which gives its push subscription in place of a token. A phone of either platform says
 * through `push-notification-threads-v1` whether it takes the notifications of side thread turns.
 */
export async function routePushNotifications(
  context: TeamApiRequestContext,
  notifications: PushNotificationService | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId, protocol } = context;
  if (method === "POST" && url.pathname === PUSH_NOTIFICATION_THREADS_ROUTES.set) {
    if (!notifications || !capabilities.has(PUSH_NOTIFICATION_THREADS_CAPABILITY)) {
      throw new HttpError(400, sourceText("error.team.pushNotificationsUnsupported"));
    }
    // `readJson` has already run the body through the push-notification-threads wire codec, which
    // takes only a body with a boolean `replies`.
    const choice = await readJson(request);
    notifications.setThreadReplies(sessionId, choice.replies === true);
    return json(200, {});
  }
  const route = pushRoute(url.pathname);
  if (method !== "POST" || !route) return "unmatched";
  if (!notifications || !capabilities.has(route.capability)) {
    throw new HttpError(400, sourceText("error.team.pushNotificationsUnsupported"));
  }
  // `readJson` has already run the body through the push-notifications wire codec.
  const body = await readJson(request);
  if (route.remove) {
    notifications.remove(sessionId);
    return json(200, {});
  }
  const target = readTarget(route.platform, body);
  if (!target) throw new HttpError(400, sourceText("error.team.pushNotificationsUnsupported"));
  notifications.register(sessionId, { memberId: member.id, protocol, capabilities }, target);
  return json(200, {});
}

function pushRoute(pathname: string) {
  switch (pathname) {
    case PUSH_NOTIFICATIONS_ROUTES.register:
    case PUSH_NOTIFICATIONS_ROUTES.remove:
      return {
        capability: PUSH_NOTIFICATIONS_CAPABILITY,
        platform: "ios",
        remove: pathname === PUSH_NOTIFICATIONS_ROUTES.remove,
      } as const;
    case ANDROID_PUSH_NOTIFICATIONS_ROUTES.register:
    case ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove:
      return {
        capability: ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
        platform: "android",
        remove: pathname === ANDROID_PUSH_NOTIFICATIONS_ROUTES.remove,
      } as const;
    case WEB_PUSH_NOTIFICATIONS_ROUTES.register:
    case WEB_PUSH_NOTIFICATIONS_ROUTES.remove:
      return {
        capability: WEB_PUSH_NOTIFICATIONS_CAPABILITY,
        platform: "web",
        remove: pathname === WEB_PUSH_NOTIFICATIONS_ROUTES.remove,
      } as const;
    default:
      return null;
  }
}

function readTarget(platform: "ios" | "android" | "web", body: unknown): PushTarget | null {
  if (platform === "android") {
    const value = readAndroidPushRegistration(body);
    return value ? { platform: "android", value } : null;
  }
  if (platform === "web") {
    const value = readWebPushRegistration(body);
    return value ? { platform: "web", value } : null;
  }
  const value = readPushRegistration(body);
  return value ? { value } : null;
}
