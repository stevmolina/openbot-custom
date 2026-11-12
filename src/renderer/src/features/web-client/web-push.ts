import type { ServerSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  WEB_PUSH_NOTIFICATIONS_CAPABILITY,
  WEB_PUSH_NOTIFICATIONS_ROUTES,
  type WebPushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-web-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { WEB_PUSH_CONFIG_ROUTE } from "@openbot/contracts/web-push";
import { createEffect, createStore, onCleanup } from "solid-js";
import { PUSH_SUBSCRIPTION_CHANGE_MESSAGE, webServiceWorkerRegistration } from "./web-service-worker";

/**
 * Web Push for the web client (`push-notifications-web-v1`): each joined server notifies this browser
 * through its push service while no window of the app is on screen, also after the window closed. The
 * server encrypts each notification for the subscription of this browser, and the account service
 * relays it, as it does for an Android phone. The service worker shows it.
 *
 * The user turns it on in the settings. The browser then asks for the permission, subscribes with the
 * VAPID key of the account service, and gives the subscription to each server that has the
 * capability. Each server hears again after each connection, when the level or the mute of the server
 * changes, and when this window shows or hides. Turning it off, or signing out, removes the
 * registration from each server and ends the subscription.
 */

/**
 * `unsupported`: no Web Push in this browser, or no service worker, as in `vite dev`. `install`: Safari
 * on iPhone and iPad has Web Push only in an app added to the Home Screen. `unavailable`: the account
 * service has no Web Push relay. `ready`: the user can turn it on.
 */
export type WebPushSupport = "checking" | "unsupported" | "install" | "unavailable" | "ready";

const ENABLED_KEY = "openbot.web.push-notifications";
/** A server that did not take the registration hears again after this time. */
const RETRY_MS = 30_000;
/** Capabilities arrive just after the server shows online. */
const CAPABILITY_WAIT_MS = 2_000;
/** A window that shows again tells the servers after this time, so a quick switch costs one request. */
const VISIBLE_DELAY_MS = 500;

interface WebPushHost {
  id: string;
  online: boolean;
  level: ServerSummary["notificationLevel"];
  /** Epoch milliseconds, `Infinity` for a mute without an end, or `null`. */
  mutedUntil: number | null;
}

export interface WebPushRuntime {
  /** The capabilities of a server, or `null` until it answered on this connection. */
  hostCapabilities?: (hostId: string) => readonly string[] | null;
  /** Sends one push registration request to a server. Rejects when the server cannot take it now. */
  postHostWebPush?: (hostId: string, path: string, body: TeamProtocolV2Json) => Promise<void>;
}

/** Whether a server gets this browser's notifications: set by `createWebPush`, read by `web-notifications.ts`. */
let coveredHosts: ReadonlySet<string> = new Set();

/**
 * Whether the server sends this browser Web Push notifications now. A hidden window then shows no
 * notification of its own for the server's agents, so the user does not get two.
 */
export function webPushCovers(hostId: string): boolean {
  return coveredHosts.has(hostId);
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // Without storage, the choice lasts for this window.
  }
}

function permission(): NotificationPermission {
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

/** Safari on iPhone and iPad. iPadOS says that it is a Mac, with touch. */
function appleMobile(): boolean {
  const agent = navigator.userAgent;
  return /iPhone|iPad|iPod/u.test(agent) || (/Macintosh/u.test(agent) && navigator.maxTouchPoints > 1);
}

/** An app from the Home Screen. Safari 16.4 and later, the first with Web Push there, says so in this query. */
function installed(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function browserHasPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/** What the browser itself allows, before the service worker and the account service answer. */
function initialSupport(): WebPushSupport {
  if (browserHasPush()) return "checking";
  return appleMobile() && !installed() ? "install" : "unsupported";
}

function base64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The VAPID public key of the account service, or `null` when it has no relay or did not answer. */
async function readPublicKey(): Promise<string | null> {
  try {
    const response = await fetch(WEB_PUSH_CONFIG_ROUTE, { credentials: "same-origin" });
    if (!response.ok) return null;
    const body = await response.json();
    const key = isDynamicRecord(body) ? body.publicKey : null;
    return typeof key === "string" && /^B[A-Za-z0-9_-]{86}$/u.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Whether a subscription was made with `publicKey`. A new key on the service needs a new subscription. */
function subscribedWith(subscription: PushSubscription, publicKey: string): boolean {
  return base64Url(subscription.options.applicationServerKey) === publicKey;
}

export function createWebPush(options: {
  servers: () => readonly ServerSummary[];
  runtime: WebPushRuntime;
  /** The interface language, for the text of the notifications. */
  locale: () => string;
}) {
  const [state, setState] = createStore({
    support: initialSupport(),
    enabled: readEnabled(),
    permission: permission(),
    busy: false,
    /** The last change from the settings failed. */
    failed: false,
    /** This browser has a subscription for the key of the account service. */
    subscribed: false,
  });
  let publicKey: string | null = null;
  let subscription: PushSubscription | null = null;
  function setSubscription(value: PushSubscription | null): void {
    subscription = value;
    setState((draft) => {
      draft.subscribed = value !== null;
    });
  }
  let disposed = false;
  /** What each server last heard: the registration as JSON, or `remove`. */
  const sent = new Map<string, string>();
  /** The servers that took a registration. */
  const registered = new Set<string>();
  const queues = new Map<string, Promise<void>>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let visibleTimer: ReturnType<typeof setTimeout> | undefined;
  let hosts: WebPushHost[] = [];
  /** A failed request starts a new round with a new key, so the same state is sent again. */
  let attempt = 0;

  function publishCoverage(): void {
    coveredHosts = state.enabled && subscription ? new Set(registered) : new Set();
  }

  /** A request cannot reach a server before the one before it. Each server has its own queue. */
  function enqueue(hostId: string, run: () => Promise<void>): Promise<void> {
    const pending = (queues.get(hostId) ?? Promise.resolve()).then(run).catch(() => undefined);
    queues.set(hostId, pending);
    return pending;
  }

  function scheduleRetry(delay: number): void {
    if (retryTimer || disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      attempt += 1;
      sync();
    }, delay);
  }

  function registration(host: WebPushHost): WebPushNotificationRegistration | null {
    if (!state.enabled || !subscription || state.permission !== "granted") return null;
    if (host.level === "nothing" || host.mutedUntil === Number.POSITIVE_INFINITY) return null;
    const p256dh = base64Url(subscription.getKey("p256dh"));
    const auth = base64Url(subscription.getKey("auth"));
    if (!p256dh || !auth) return null;
    return {
      serverId: host.id,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      locale: options.locale(),
      // A window on screen shows the events itself. The server holds them in case the window closes.
      away: document.visibilityState !== "visible",
      level: host.level,
      mutedUntil: host.mutedUntil === null ? null : Math.ceil(host.mutedUntil / 1_000),
      // The notification is encrypted for this browser, so it can show the start of the reply.
      preview: true,
    };
  }

  /** Tells each online server with the capability what it has not heard yet. */
  function sync(): void {
    if (disposed || state.support === "checking") return;
    const post = options.runtime.postHostWebPush;
    const capabilitiesOf = options.runtime.hostCapabilities;
    if (!post || !capabilitiesOf) return;
    for (const host of hosts) {
      // A server forgets nothing while this browser is away, but it hears the state again on reconnect.
      if (!host.online) {
        sent.delete(host.id);
        continue;
      }
      const capabilities = capabilitiesOf(host.id);
      if (!capabilities) {
        scheduleRetry(CAPABILITY_WAIT_MS);
        continue;
      }
      if (!capabilities.includes(WEB_PUSH_NOTIFICATIONS_CAPABILITY)) continue;
      const value = registration(host);
      // Push that was never on here sends one removal, in case another window of this account turned it off.
      const key = `${attempt}:${value ? JSON.stringify(value) : "remove"}`;
      if (sent.get(host.id) === key) continue;
      sent.set(host.id, key);
      const hostId = host.id;
      void enqueue(hostId, async () => {
        try {
          if (value) await post(hostId, WEB_PUSH_NOTIFICATIONS_ROUTES.register, { ...value });
          else await post(hostId, WEB_PUSH_NOTIFICATIONS_ROUTES.remove, {});
          if (value) registered.add(hostId);
          else registered.delete(hostId);
          publishCoverage();
        } catch {
          if (sent.get(hostId) === key) sent.delete(hostId);
          scheduleRetry(RETRY_MS);
        }
      });
    }
    // A server that left the list cannot be told. Removing the member there forgets the browser.
    const listed = new Set(hosts.map((host) => host.id));
    for (const hostId of [...sent.keys()]) if (!listed.has(hostId)) sent.delete(hostId);
    for (const hostId of [...registered]) if (!listed.has(hostId)) registered.delete(hostId);
    publishCoverage();
  }

  /** The subscription of this browser for the current key, made when the permission allows it. */
  async function ensureSubscription(create: boolean): Promise<PushSubscription | null> {
    if (!publicKey) return null;
    const worker = await webServiceWorkerRegistration();
    if (!worker) return null;
    const existing = await worker.pushManager.getSubscription();
    if (existing && subscribedWith(existing, publicKey)) return existing;
    if (existing) await existing.unsubscribe().catch(() => false);
    if (!create || permission() !== "granted") return null;
    return worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) });
  }

  async function start(): Promise<void> {
    if (!browserHasPush()) return;
    const [worker, key] = await Promise.all([webServiceWorkerRegistration(), readPublicKey()]);
    if (disposed) return;
    publicKey = key;
    const support: WebPushSupport = !worker ? "unsupported" : key ? "ready" : "unavailable";
    if (support === "ready" && state.enabled) {
      setSubscription(await ensureSubscription(true).catch(() => null));
      if (disposed) return;
    }
    setState((draft) => {
      draft.support = support;
      draft.permission = permission();
    });
    sync();
  }

  /** The user turns Web Push on or off. Call it from the click: the browser asks only then. */
  async function setEnabled(enabled: boolean): Promise<void> {
    if (state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.failed = false;
    });
    try {
      if (enabled) {
        // Safari shows the prompt only when it is asked in the click, before any wait.
        const answer = await Promise.resolve(Notification.requestPermission());
        setState((draft) => {
          draft.permission = answer;
        });
        if (answer !== "granted") return;
        setSubscription(await ensureSubscription(true));
        if (!subscription) throw new Error("No push subscription.");
        writeEnabled(true);
        setState((draft) => {
          draft.enabled = true;
        });
        sync();
        return;
      }
      await turnOff();
    } catch {
      setState((draft) => {
        draft.failed = true;
      });
    } finally {
      setState((draft) => {
        draft.busy = false;
      });
    }
  }

  /** Removes the registration from each server that has it, and ends the subscription. */
  async function turnOff(): Promise<void> {
    writeEnabled(false);
    setState((draft) => {
      draft.enabled = false;
    });
    const post = options.runtime.postHostWebPush;
    const removals = [...new Set([...registered, ...queues.keys()])].map((hostId) => {
      sent.set(hostId, `${attempt}:remove`);
      return enqueue(hostId, async () => {
        await post?.(hostId, WEB_PUSH_NOTIFICATIONS_ROUTES.remove, {});
        registered.delete(hostId);
      });
    });
    registered.clear();
    publishCoverage();
    const ending = subscription;
    setSubscription(null);
    // A server that missed the removal gets 410 from the push service after the subscription ends.
    await Promise.all([...removals, ending?.unsubscribe().catch(() => false)]);
  }

  /** The push service replaced the subscription. The servers get the new one. */
  async function renew(): Promise<void> {
    if (!state.enabled) return;
    setSubscription(await ensureSubscription(true).catch(() => null));
    sent.clear();
    sync();
  }

  createEffect(
    (): WebPushHost[] =>
      options.servers().map((server) => ({
        id: server.id,
        online: server.state === "online",
        level: server.notificationLevel,
        mutedUntil: !server.notificationsMuted
          ? null
          : server.notificationsMutedUntil === null
            ? Number.POSITIVE_INFINITY
            : server.notificationsMutedUntil,
      })),
    (next) => {
      hosts = next;
      sync();
    },
  );

  const onVisibility = () => {
    clearTimeout(visibleTimer);
    // A window that hides can close at once, so the servers hear it without a wait.
    if (document.visibilityState !== "visible") sync();
    else visibleTimer = setTimeout(sync, VISIBLE_DELAY_MS);
  };
  const onWorkerMessage = (event: MessageEvent) => {
    if (isDynamicRecord(event.data) && event.data.type === PUSH_SUBSCRIPTION_CHANGE_MESSAGE) void renew();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onVisibility);
  if (browserHasPush()) navigator.serviceWorker.addEventListener("message", onWorkerMessage);
  void start();

  onCleanup(() => {
    disposed = true;
    clearTimeout(retryTimer);
    clearTimeout(visibleTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onVisibility);
    if (browserHasPush()) navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
    coveredHosts = new Set();
  });

  return {
    support: () => state.support,
    enabled: () => state.enabled && state.subscribed,
    permission: () => state.permission,
    busy: () => state.busy,
    failed: () => state.failed,
    setEnabled,
    /**
     * Sign-out: the servers forget this browser and the subscription ends. The choice is cleared, so
     * the next account on this browser turns it on itself.
     */
    signOut: () => turnOff(),
  };
}

export type WebPush = ReturnType<typeof createWebPush>;
