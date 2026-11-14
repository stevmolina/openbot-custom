// The service worker of the web client at /app. `service-worker-plugin.ts` fills in the three
// placeholders below and serves this file at /app-sw.js, with the scope /app.
//
// It keeps the app shell only, so that the web client starts when the network is down:
// - /assets/* files have a content hash in their name, so a cached copy is always the right one.
//   They are cache-first. Their cache stays across deploys: a new worker removes only the files that
//   its build does not use, so a deploy downloads only the files that changed.
// - The /app page is network-first. The cached copy answers only when the network fails.
// It never keeps chats, host data or any API answer. Only the two kinds of request above get an
// answer from this file, so every other request, including /v1, /v2, /api and other origins,
// goes straight to the network.
//
// It also shows Web Push notifications. The payload (version 1) is JSON:
//   { "v": 1, "title": string, "body": string, "tag"?: string, "path": string }
const BUILD_ID = "__OPENBOT_BUILD_ID__";
const APP_NAME = "__OPENBOT_APP_NAME__";

/** The `/assets/` paths of this build. */
const ASSET_PATHS = new Set(["__OPENBOT_ASSET_PATHS__"]);

const SHELL_CACHE = `openbot-web-shell-${BUILD_ID}`;
const ASSET_CACHE = "openbot-web-assets";
/** Workers before the shared asset cache kept one asset cache per build. */
const BUILD_ASSET_CACHE_PREFIX = "openbot-web-assets-";
const CACHE_PREFIX = "openbot-web-";
const SHELL_KEY = "/app";
const APP_PATH = "/app";
const ICON = "/icon-192x192.png";
const NOTIFICATION_OPEN_MESSAGE = "openbot-notification-open";
const PUSH_SUBSCRIPTION_CHANGE_MESSAGE = "openbot-push-subscription-change";

/** True for /app and the paths under it, and not for /application or /app-preview. */
function isAppPath(pathname) {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
}

self.addEventListener("install", () => {
  // The new worker waits until the page asks for it with SKIP_WAITING, so an open chat is not
  // swapped under the user.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await keepUsedAssets();
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Moves the files of this build from the per-build caches of older workers into the shared cache, and
 * removes the files that this build does not use. A failure leaves files that the next fetch replaces.
 */
async function keepUsedAssets() {
  try {
    const cache = await caches.open(ASSET_CACHE);
    for (const name of await caches.keys()) {
      if (!name.startsWith(BUILD_ASSET_CACHE_PREFIX)) continue;
      const old = await caches.open(name);
      await Promise.all(
        (await old.keys()).map(async (request) => {
          if (!ASSET_PATHS.has(new URL(request.url).pathname) || (await cache.match(request))) return;
          const response = await old.match(request);
          if (response) await cache.put(request, response);
        }),
      );
    }
    await Promise.all(
      (await cache.keys()).map((request) =>
        ASSET_PATHS.has(new URL(request.url).pathname) ? undefined : cache.delete(request),
      ),
    );
  } catch {
    // The asset cache is an optimization. Activation must not fail because of it.
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && isAppPath(url.pathname)) {
    event.respondWith(navigationResponse(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) event.respondWith(assetResponse(request));
});

async function navigationResponse(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(SHELL_CACHE)
          .then((cache) => cache.put(SHELL_KEY, copy))
          .catch(() => undefined),
      );
    }
    return response;
  } catch (error) {
    // Offline: the shell of the last visit. Without one, the browser shows its own offline page.
    const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function assetResponse(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

self.addEventListener("push", (event) => {
  event.waitUntil(showPushNotification(event));
});

async function showPushNotification(event) {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (payload && typeof payload === "object" && payload.v !== undefined && payload.v !== 1) return;
  // A push with no visible notification makes iOS and Chrome withdraw the permission, so each push
  // shows one. A payload that does not parse shows the app name only.
  if (!payload || typeof payload !== "object" || typeof payload.title !== "string" || payload.title === "") {
    await self.registration.showNotification(APP_NAME, { icon: ICON, data: { path: APP_PATH } });
    return;
  }
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: ICON,
    data: { path: safePath(payload.path) },
  };
  if (typeof payload.tag === "string" && payload.tag !== "") options.tag = payload.tag;
  await self.registration.showNotification(payload.title, options);
}

/** Only a path inside /app opens from a notification; anything else opens /app. */
function safePath(path) {
  if (typeof path !== "string" || !path.startsWith(APP_PATH) || path.startsWith("//")) return APP_PATH;
  try {
    const url = new URL(path, self.location.origin);
    return url.origin === self.location.origin && isAppPath(url.pathname) ? path : APP_PATH;
  } catch {
    return APP_PATH;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const path = safePath(data?.path);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => isAppPath(new URL(client.url).pathname));
      if (open) {
        await open.focus();
        open.postMessage({ type: NOTIFICATION_OPEN_MESSAGE, path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: PUSH_SUBSCRIPTION_CHANGE_MESSAGE });
    })(),
  );
});
