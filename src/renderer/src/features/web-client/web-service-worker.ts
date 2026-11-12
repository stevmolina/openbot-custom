import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/**
 * The service worker of the web client. `apps/auth-api/service-worker/app-sw.js` is its code, and the
 * Worker serves it at `/app-sw.js`. It keeps the app shell so that `/app` starts offline, and it shows
 * Web Push notifications. It never keeps chats or host data.
 *
 * `vite dev` serves the worker too (`service-worker-plugin.ts`), so push and the update prompt can be
 * tried there. In development it keeps no `/assets/` file and answers `/app` from the network.
 */

/** Where the Worker serves the worker file. */
export const WEB_SERVICE_WORKER_URL = "/app-sw.js";
/** The scope of the worker: the web client and the paths under it. */
export const WEB_SERVICE_WORKER_SCOPE = "/app";
/** The worker tells an open window to open a path, after a click on a notification. */
export const NOTIFICATION_OPEN_MESSAGE = "openbot-notification-open";
/** The worker tells open windows that the push service replaced the push subscription. */
export const PUSH_SUBSCRIPTION_CHANGE_MESSAGE = "openbot-push-subscription-change";
/** The page asks a waiting worker to take over. */
const SKIP_WAITING_MESSAGE = "SKIP_WAITING";
/** A window that stays open checks for a new version when it comes back, at most this often. */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
const updateListeners = new Set<() => void>();
let updateReady = false;
let reloading = false;

function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Registers the worker once. Does nothing where the browser has no service workers. */
export function registerWebServiceWorker(): void {
  if (registrationPromise || !supported()) return;
  registrationPromise = register();
}

/**
 * The registration of the worker, once the worker is active. It is null when the browser has no service
 * workers or when the registration failed. It never rejects.
 */
export function webServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  registerWebServiceWorker();
  return registrationPromise ?? Promise.resolve(null);
}

/**
 * Calls the listener with the `path` of a notification that the user clicked while this window was
 * open. Returns the function that stops it. The path starts with `/app`.
 */
export function onWebNotificationOpen(listener: (path: string) => void): () => void {
  if (!supported()) return () => undefined;
  const handle = (event: MessageEvent) => {
    const message = event.data;
    if (!isDynamicRecord(message)) return;
    if (message.type === NOTIFICATION_OPEN_MESSAGE && typeof message.path === "string") listener(message.path);
  };
  navigator.serviceWorker.addEventListener("message", handle);
  return () => navigator.serviceWorker.removeEventListener("message", handle);
}

/**
 * Calls the listener when a new version of the web client is installed and waits for the user. A new
 * version that is already waiting calls it at once. Returns the function that stops it.
 */
export function onWebUpdateReady(listener: () => void): () => void {
  updateListeners.add(listener);
  if (updateReady) listener();
  return () => updateListeners.delete(listener);
}

/** Makes the waiting worker active, and reloads the page once it controls it. */
export async function applyWebUpdate(): Promise<void> {
  const registration = await webServiceWorkerRegistration();
  const waiting = registration?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
}

async function register(): Promise<ServiceWorkerRegistration | null> {
  try {
    const registration = await navigator.serviceWorker.register(WEB_SERVICE_WORKER_URL, {
      scope: WEB_SERVICE_WORKER_SCOPE,
    });
    watchForUpdates(registration);
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  // The first install has no controller yet, and it needs no prompt: nothing old is on the page.
  const announce = () => {
    if (!navigator.serviceWorker.controller) return;
    updateReady = true;
    for (const listener of updateListeners) listener();
  };
  if (registration.waiting) announce();
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") announce();
    });
  });
  // One reload when the new worker takes over, the one that `applyWebUpdate` asked for.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateReady || reloading) return;
    reloading = true;
    window.location.reload();
  });
  let lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    void registration.update().catch(() => undefined);
  });
}
