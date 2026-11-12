// app.pokebots.xyz: the account Worker (openbot-auth-api) serves every path through the
// route app.pokebots.xyz/*. This Worker owns two exact paths only:
// - "/" opens the web client at /app on the same host.
// - "/sw.js" replaces the service worker of the old app that used this host before
//   2026-11-12. It clears that app's caches, removes itself and reloads open tabs at /app.
const KILL_SW = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    for (const client of windows) client.navigate("/app");
  })());
});
`;

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/sw.js") {
      return new Response(KILL_SW, {
        headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return Response.redirect(new URL("/app", url).toString(), 302);
  },
};
