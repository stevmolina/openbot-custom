// Checks that the web client at `/app` is an installable PWA, in a real browser, and writes
// .openbot-build/web-pwa/report.json.
//
// It starts `vite preview` of the last `bun run build` in apps/auth-api (no secrets), or, with `--dev`
// or when there is no build, `vite dev`, with a small proxy in front that can change the bytes of `/app-sw.js`, to play a new deploy. It checks:
// - the manifest: required fields, display modes, icons (also maskable) that load as PNG;
// - the `/app` head: one viewport with `viewport-fit=cover`, one theme-color, the iOS and Chrome tags;
// - `/app-sw.js`: no-cache header, the service worker becomes active with the scope `/app`, controls the
//   next load, and starts the app with the network off after one visit;
// - the caches: only same-origin `/app` and `/assets/*`, nothing of `/v1`, `/v2` or `/api`;
// - the update: a changed worker waits, the page shows "A new version is ready", "Reload" makes it
//   active and the page reloads once;
// - push: a `push` event shows a notification and a click with a bad path opens `/app`.
//
// `bun scripts/web-pwa-e2e.ts [--url=<server>] [--dev] [--build] [--browser-executable=<path>]`
// Run it under `~/.local/bin/vps-dev-run` on the VPS.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { type Browser, chromium, type Page } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const OUT = resolve(ROOT, ".openbot-build/web-pwa");
const SW_PATH = "/app-sw.js";
/** `preview` serves the built files, `dev` the dev server. The dev server has no `/assets/` files to cache. */
let mode: "preview" | "dev" = "preview";

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}
const checks: Check[] = [];
async function check(name: string, run: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const detail = await run();
    checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    checks.push({ name, ok: false, detail: String(error instanceof Error ? error.message : error) });
    process.stdout.write(`FAIL ${name}: ${String(error)}\n`);
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  return address.port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function waitForOk(url: string, child: ChildProcess | null): Promise<void> {
  const deadline = Date.now() + 420_000;
  for (;;) {
    assert.ok(!child || child.exitCode === null, "vite preview stopped during startup.");
    const ok = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    assert.ok(Date.now() < deadline, `${url} did not answer in 420 s.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Starts `vite preview` of the last build, or `vite dev`, and stops only the process group it started. */
async function startServer(mode: "preview" | "dev"): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const command = mode === "preview" ? ["vite", "preview"] : ["vite"];
  const child = spawn("bunx", [...command, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: API_DIR,
    detached: true,
    stdio: "ignore",
  });
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForOk(`${url}/app`, child);
  } catch (error) {
    stop();
    throw error;
  }
  return { url, stop };
}

/** A proxy that adds a comment to the worker file while `suffix` is set: a new deploy, for the browser. */
async function startProxy(
  upstream: string,
): Promise<{ url: string; server: Server; setSuffix: (value: string) => void }> {
  let suffix = "";
  const server = createServer((request, response) => {
    void (async () => {
      const target = await fetch(`${upstream}${request.url ?? "/"}`, {
        method: request.method,
        redirect: "manual",
      });
      const headers = new Headers(target.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      let body = Buffer.from(await target.arrayBuffer());
      if ((request.url ?? "").split("?")[0] === SW_PATH && suffix !== "") {
        body = Buffer.concat([body, Buffer.from(`\n// ${suffix}\n`)]);
      }
      response.writeHead(target.status, Object.fromEntries(headers));
      response.end(body);
    })().catch(() => {
      response.writeHead(502).end();
    });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    setSuffix: (value) => {
      suffix = value;
    },
  };
}

interface MetaTag {
  name: string;
  content: string;
}

async function readHead(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    meta: [...document.querySelectorAll("head meta[name]")].map((meta) => ({
      name: meta.getAttribute("name") ?? "",
      content: meta.getAttribute("content") ?? "",
    })),
    links: [...document.querySelectorAll("head link[rel]")].map((link) => ({
      rel: link.getAttribute("rel") ?? "",
      href: link.getAttribute("href") ?? "",
    })),
  }));
}

function metaValues(meta: MetaTag[], name: string): string[] {
  return meta.filter((tag) => tag.name === name).map((tag) => tag.content);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (process.argv.includes("--build")) {
    process.stdout.write("Building apps/auth-api (bun run build)...\n");
    const result = spawnSync("bun", ["run", "build"], { cwd: API_DIR, stdio: "inherit" });
    assert.equal(result.status, 0, "The build failed.");
  }
  mode =
    process.argv.includes("--dev") || !existsSync(resolve(API_DIR, "dist/client", SW_PATH.slice(1)))
      ? "dev"
      : "preview";
  const preview = option("url") ? null : await startServer(mode);
  const upstream = option("url")?.replace(/\/$/, "") ?? preview?.url;
  assert.ok(upstream);
  const proxy = await startProxy(upstream);
  const executablePath = option("browser-executable");
  const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const base = proxy.url;
    await runChecks(browser, base, proxy.setSuffix);
  } finally {
    await browser.close().catch(() => undefined);
    proxy.server.close();
    preview?.stop();
  }
  const failed = checks.filter((item) => !item.ok);
  writeFileSync(
    resolve(OUT, "report.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        mode,
        passed: checks.length - failed.length,
        failed: failed.length,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${checks.length - failed.length}/${checks.length} checks passed. Report: ${resolve(OUT, "report.json")}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

async function runChecks(browser: Browser, base: string, setSuffix: (value: string) => void): Promise<void> {
  await check("manifest has the required fields", async () => {
    const response = await fetch(`${base}/site.webmanifest`);
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.ok(isDynamicRecord(manifest), "The manifest is not an object.");
    assert.equal(manifest.start_url, "/app");
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(manifest.display_override, ["standalone", "minimal-ui"]);
    assert.equal(typeof manifest.name, "string");
    assert.equal(typeof manifest.short_name, "string");
    assert.equal(manifest.orientation, "any");
    assert.ok(Array.isArray(manifest.categories) && manifest.categories.length > 0);
    assert.equal(manifest.theme_color, "#1a1a1a");
    assert.ok(Array.isArray(manifest.icons), "The manifest has no icons.");
    const loaded: string[] = [];
    for (const icon of manifest.icons) {
      assert.ok(isDynamicRecord(icon) && typeof icon.src === "string", "An icon has no src.");
      const image = await fetch(`${base}${icon.src}`);
      assert.equal(image.status, 200, `${icon.src} does not load`);
      assert.equal(image.headers.get("content-type"), "image/png", `${icon.src} is not a PNG`);
      loaded.push(`${icon.purpose} ${icon.sizes}`);
    }
    for (const purpose of ["any", "maskable"])
      for (const size of ["192x192", "512x512"])
        assert.ok(loaded.includes(`${purpose} ${size}`), `no ${purpose} icon of ${size}`);
    return { icons: loaded, name: manifest.name };
  });

  await check("/app-sw.js is served with no-cache", async () => {
    const response = await fetch(`${base}${SW_PATH}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    assert.match(response.headers.get("cache-control") ?? "", /no-cache/);
    const source = await response.text();
    assert.ok(
      !source.includes("__OPENBOT_BUILD_ID__") && !source.includes("__OPENBOT_APP_NAME__"),
      "placeholders left",
    );
    assert.match(source, /const BUILD_ID = "(dev|[0-9a-f]{16})"/);
    return { cacheControl: response.headers.get("cache-control"), bytes: source.length };
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.goto(`${base}/app`, { waitUntil: "load" });
    await page.locator("input[type=email]").first().waitFor({ timeout: 60_000 });

    await check("/app head has the PWA tags, once each", async () => {
      const head = await readHead(page);
      const once = (name: string) => {
        const values = metaValues(head.meta, name);
        assert.equal(values.length, 1, `${name} appears ${values.length} times`);
        return values[0] ?? "";
      };
      assert.match(once("viewport"), /viewport-fit=cover/);
      assert.match(once("theme-color"), /^#[0-9a-f]{6}$/i);
      assert.equal(once("apple-mobile-web-app-capable"), "yes");
      assert.equal(once("mobile-web-app-capable"), "yes");
      assert.equal(once("apple-mobile-web-app-status-bar-style"), "black-translucent");
      assert.ok(once("apple-mobile-web-app-title").length > 0);
      const touchIcons = head.links.filter((link) => link.rel === "apple-touch-icon");
      assert.equal(touchIcons.length, 1, "apple-touch-icon is not once");
      assert.equal(head.links.filter((link) => link.rel === "manifest").length, 1);
      return { title: head.title, meta: head.meta, links: head.links.filter((l) => l.rel !== "preload") };
    });

    await check("theme-color follows the saved theme", async () => {
      const dark = await page.evaluate(() =>
        document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      );
      await page.evaluate(() => {
        document.documentElement.dataset.openbotColorScheme = "light";
      });
      const light = await page
        .waitForFunction(
          () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content") === "#f5f5f6",
        )
        .then(() => "#f5f5f6");
      await page.evaluate(() => {
        document.documentElement.dataset.openbotColorScheme = "dark";
      });
      await page.waitForFunction(
        () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content") === "#1a1a1a",
      );
      return { dark, light };
    });

    await check("the service worker registers, becomes active, with the scope /app", async () => {
      const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return {
          scope: registration.scope,
          active: registration.active?.state,
          script: registration.active?.scriptURL,
        };
      });
      assert.equal(new URL(state.scope).pathname, "/app");
      assert.equal(state.active, "activated");
      assert.equal(new URL(state.script ?? "").pathname, SW_PATH);
      return state;
    });

    await check("the next load is controlled by the worker", async () => {
      await page.reload({ waitUntil: "load" });
      await page.locator("input[type=email]").first().waitFor({ timeout: 60_000 });
      const controlled = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");
      assert.equal(new URL(controlled).pathname, SW_PATH);
      return { controller: controlled };
    });

    await check("host and API requests are never cached", async () => {
      const result = await page.evaluate(async () => {
        const answers = [];
        for (const path of ["/v1/e2e-pwa-probe", "/v2/e2e-pwa-probe", "/api/e2e-pwa-probe"]) {
          const response = await fetch(path).catch(() => null);
          answers.push({ path, status: response?.status ?? 0 });
        }
        const keys = await caches.keys();
        const urls: string[] = [];
        for (const key of keys) for (const request of await (await caches.open(key)).keys()) urls.push(request.url);
        return { answers, keys, urls };
      });
      const paths = result.urls.map((url) => new URL(url).pathname);
      assert.ok(
        result.keys.length > 0 && result.keys.every((key) => key.startsWith("openbot-web-")),
        `caches: ${result.keys}`,
      );
      assert.ok(paths.includes("/app"), "the /app shell is not cached");
      if (mode === "preview")
        assert.ok(
          paths.some((path) => path.startsWith("/assets/")),
          "no /assets file is cached",
        );
      for (const url of result.urls) {
        const parsed = new URL(url);
        assert.equal(parsed.origin, new URL(base).origin, `cross-origin entry ${url}`);
        assert.ok(parsed.pathname === "/app" || parsed.pathname.startsWith("/assets/"), `unexpected entry ${url}`);
      }
      return { probes: result.answers, cacheNames: result.keys, entries: result.urls.length };
    });

    await check("/app starts with the network off, from the cached shell", async () => {
      await page.context().setOffline(true);
      try {
        await page.reload({ waitUntil: "load" });
        await page.locator("input[type=email]").first().waitFor({ timeout: 30_000 });
        return { title: await page.title() };
      } finally {
        await page.context().setOffline(false);
      }
    });

    await check("push: shows the notification, rejects bad payloads and paths", async () => {
      await context.grantPermissions(["notifications"], { origin: new URL(base).origin });
      const cdp = await context.newCDPSession(page);
      const registrationIds = new Set<string>();
      cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => {
        for (const item of event.registrations) registrationIds.add(item.registrationId);
      });
      await cdp.send("ServiceWorker.enable");
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      for (let attempt = 0; registrationIds.size === 0 && attempt < 50; attempt += 1)
        await new Promise((done) => setTimeout(done, 100));
      const registrationId = [...registrationIds][0];
      assert.ok(registrationId, "no registration id from the browser");
      const push = async (data: string) => {
        await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(base).origin, registrationId, data });
        // The worker finishes the push event before the notification list shows it.
        await new Promise((done) => setTimeout(done, 400));
      };
      const notifications = () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/app");
          const list = await registration?.getNotifications();
          return (list ?? []).map((item) => ({
            title: item.title,
            body: item.body,
            tag: item.tag,
            data: item.data,
            icon: item.icon,
          }));
        });
      await push(
        JSON.stringify({ v: 1, title: "Ada", body: "Your build is done", tag: "chat-1", path: "/app?thread=7" }),
      );
      const first = await notifications();
      const shown = first.find((item) => item.tag === "chat-1");
      assert.ok(shown, `no notification with the tag: ${JSON.stringify(first)}`);
      assert.equal(shown.title, "Ada");
      assert.equal(shown.body, "Your build is done");
      assert.deepEqual(shown.data, { path: "/app?thread=7" });
      assert.match(shown.icon, /\/icon-192x192\.png$/);
      await push("this is not json");
      const second = await notifications();
      assert.ok(
        second.some((item) => item.title === "OpenBot" && item.tag === ""),
        "no generic notification for a bad payload",
      );
      await push(JSON.stringify({ v: 2, title: "Future", body: "x", path: "/app" }));
      assert.ok(!(await notifications()).some((item) => item.title === "Future"), "an unknown version was shown");
      await push(JSON.stringify({ v: 1, title: "Evil", body: "x", tag: "evil", path: "https://example.com/app" }));
      const evil = (await notifications()).find((item) => item.tag === "evil");
      assert.ok(evil, "no notification for the bad path");
      assert.deepEqual(evil.data, { path: "/app" });
      await push(JSON.stringify({ v: 1, title: "Evil2", body: "x", tag: "evil2", path: "/application" }));
      assert.deepEqual((await notifications()).find((item) => item.tag === "evil2")?.data, { path: "/app" });
      await cdp.detach();
      return { shown };
    });

    await check("a changed worker waits, shows the prompt, and Reload activates it", async () => {
      const before = await page.evaluate(async () => (await fetch("/app-sw.js", { cache: "no-store" })).text());
      setSuffix("e2e new deploy");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/app");
        await registration?.update();
      });
      await page.waitForFunction(
        async () => (await navigator.serviceWorker.getRegistration("/app"))?.waiting?.state === "installed",
        undefined,
        { timeout: 30_000 },
      );
      const toast = page.getByText("A new version is ready");
      await toast.waitFor({ timeout: 15_000 });
      const reloaded = page.waitForEvent("load", { timeout: 30_000 });
      await page.getByRole("button", { name: "Reload" }).click();
      await reloaded;
      await page.locator("input[type=email]").first().waitFor({ timeout: 60_000 });
      const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/app");
        const script = await (await fetch("/app-sw.js", { cache: "no-store" })).text();
        return {
          waiting: registration?.waiting?.state ?? null,
          active: registration?.active?.state ?? null,
          controlled: navigator.serviceWorker.controller !== null,
          changed: script.includes("e2e new deploy"),
          caches: await caches.keys(),
        };
      });
      assert.equal(state.waiting, null);
      assert.equal(state.active, "activated");
      assert.ok(state.controlled);
      assert.ok(state.changed && !before.includes("e2e new deploy"));
      return state;
    });

    await check("the old worker's caches are deleted on activate", async () => {
      const keys = await page.evaluate(() => caches.keys());
      const ids = new Set(keys.map((key) => key.replace(/^openbot-web-(shell|assets)-/, "")));
      assert.equal(ids.size, 1, `caches of more than one build: ${keys.join(", ")}`);
      return { keys };
    });

    await check("the page had no script errors", () => {
      assert.deepEqual(consoleErrors, []);
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}

await main();
