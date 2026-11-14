// Measures how many `/assets/*` files the web client at `/app` downloads again after a deploy, and
// writes .openbot-build/web-sw-asset-cache/report.json.
//
// It uses two builds of apps/auth-api: build A, and build B with one changed German string. A deploy
// of a small change renames only the chunks that the change reaches, so most files keep their names.
// `--build` makes both builds (it changes the string, builds, and puts it back); without it, the
// script uses the builds of an earlier `--build` run.
//
// For each browser it runs three cases, each on its own origin, in front of `vite preview` (no
// secrets):
// - `before`: the service worker of `--before-ref` (default: the commit before the shared asset cache)
//   on both builds. It kept one asset cache per build and deleted it on each deploy.
// - `after`: the service worker of this checkout on both builds.
// - `upgrade`: the old worker on build A, then this worker on build B: the first deploy of the change.
// Each case loads `/app` on build A until the worker controls it and has cached the files, switches
// the server to build B, finds the update, clicks "Reload" in the prompt, and counts the `/assets/*`
// requests that reach the server on that load. The proxy sends `/assets/*` with `no-store`, so the
// HTTP cache of the browser cannot hide what the worker does.
//
// It also checks that the new worker removes the files that build B does not use, keeps no cache of
// an older build, and keeps no answer of `/v1`, `/v2` or `/api`.
//
// `bun scripts/web-sw-asset-cache-e2e.ts [--build] [--browsers=chromium,webkit] [--before-ref=<git ref>]`
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { type Browser, type BrowserType, chromium, type Page, webkit } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const DIST = resolve(API_DIR, "dist");
const DIST_BACKUP = resolve(API_DIR, "dist.web-sw-e2e-backup");
const OUT = resolve(ROOT, ".openbot-build/web-sw-asset-cache");
const BUILD_A = resolve(OUT, "build-a");
const BUILD_B = resolve(OUT, "build-b");
const CATALOG = resolve(ROOT, "packages/i18n/src/messages/de/common.ts");
const CATALOG_FROM = '"common.cancel": "Abbrechen",';
const CATALOG_TO = '"common.cancel": "Abbrechen (e2e)",';
const SW_PATH = "/app-sw.js";
const SHARED_ASSET_CACHE = "openbot-web-assets";
/** The last commit whose worker kept one asset cache per build. */
const DEFAULT_BEFORE_REF = "e6bafe315";
const SIGNED_OUT = JSON.stringify({ error: { code: "sign_in_required", message: "Sign in is required." } });

type Variant = "before" | "after" | "upgrade";
const VARIANTS: Variant[] = ["before", "after", "upgrade"];

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

// Builds

function buildInto(target: string): void {
  restoreDist();
  const result = spawnSync("bun", ["run", "build"], { cwd: API_DIR, stdio: "inherit" });
  assert.equal(result.status, 0, "The build failed.");
  rmSync(target, { recursive: true, force: true });
  cpSync(DIST, target, { recursive: true });
}

function makeBuilds(): void {
  mkdirSync(OUT, { recursive: true });
  process.stdout.write("Building A...\n");
  buildInto(BUILD_A);
  const original = readFileSync(CATALOG, "utf8");
  assert.ok(original.includes(CATALOG_FROM), `${CATALOG} no longer has ${CATALOG_FROM}`);
  try {
    writeFileSync(CATALOG, original.replace(CATALOG_FROM, CATALOG_TO));
    process.stdout.write("Building B (one German string changed)...\n");
    buildInto(BUILD_B);
  } finally {
    writeFileSync(CATALOG, original);
  }
}

/** `vite preview` serves apps/auth-api/dist only, so dist points at the build to serve. */
function useDist(build: string): void {
  const current = lstatSync(DIST, { throwIfNoEntry: false });
  if (current?.isSymbolicLink()) unlinkSync(DIST);
  else if (current) {
    assert.ok(!existsSync(DIST_BACKUP), `${DIST_BACKUP} exists already`);
    renameSync(DIST, DIST_BACKUP);
  }
  symlinkSync(build, DIST);
}

/** Puts the developer's own dist back, also after a run that was stopped. */
function restoreDist(): void {
  if (lstatSync(DIST, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(DIST);
  if (existsSync(DIST_BACKUP) && !existsSync(DIST)) renameSync(DIST_BACKUP, DIST);
}

interface BuildInfo {
  buildId: string;
  assets: string[];
}

function readBuild(build: string): BuildInfo {
  const source = readFileSync(resolve(build, "client", SW_PATH.slice(1)), "utf8");
  const buildId = /const BUILD_ID = "([0-9a-f]{16})"/.exec(source)?.[1];
  assert.ok(buildId, `${build} has no built service worker`);
  const list = /const ASSET_PATHS = new Set\((\[.*?\])\);/s.exec(source)?.[1];
  assert.ok(list, `${build} was built without the asset list`);
  const parsed = JSON.parse(list);
  assert.ok(Array.isArray(parsed), "the asset list is not an array");
  const assets = parsed.filter((item): item is string => typeof item === "string");
  assert.equal(assets.length, parsed.length, "the asset list has an entry that is not a string");
  return { buildId, assets };
}

// Servers

async function waitForOk(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 420_000;
  for (;;) {
    assert.ok(child.exitCode === null, "vite preview stopped during startup.");
    const ok = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    assert.ok(Date.now() < deadline, `${url} did not answer in 420 s.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Starts `vite preview` of `build` and stops only the process group that it started. */
async function startPreview(build: string): Promise<{ url: string; stop: () => Promise<void> }> {
  useDist(build);
  const port = await freePort();
  const child = spawn("bunx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: API_DIR,
    detached: true,
    stdio: "ignore",
  });
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  const stop = async () => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
    await exited;
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForOk(`${url}/app`, child);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, stop };
}

interface Traffic {
  requests: number;
  bytes: number;
}

/**
 * One origin per case. It forwards to the current upstream, swaps in the old worker where the case
 * needs it, sends `/assets/*` with `no-store`, and counts the `/assets/*` requests per phase.
 */
async function startProxy(
  state: { upstream: string },
  oldWorker: (build: "a" | "b") => boolean,
  beforeTemplate: string,
) {
  let phase = "";
  let build: "a" | "b" = "a";
  const traffic = new Map<string, Traffic>();
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? "/";
      if (path === "/api/browser/session") {
        response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end(SIGNED_OUT);
        return;
      }
      const forwarded: Record<string, string> = {};
      for (const name of ["accept", "accept-language", "cookie"]) {
        const value = request.headers[name];
        if (typeof value === "string") forwarded[name] = value;
      }
      const target = await fetch(`${state.upstream}${path}`, {
        method: request.method,
        headers: forwarded,
        redirect: "manual",
      });
      const headers = new Headers(target.headers);
      for (const name of ["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"])
        headers.delete(name);
      let body = Buffer.from(await target.arrayBuffer());
      const pathname = path.split("?")[0] ?? path;
      if (pathname === SW_PATH && oldWorker(build)) {
        const built = body.toString("utf8");
        const buildId = /const BUILD_ID = "([^"]+)"/.exec(built)?.[1] ?? "unknown";
        const appName = /const APP_NAME = "([^"]+)"/.exec(built)?.[1] ?? "OpenBot";
        body = Buffer.from(
          beforeTemplate.replace("__OPENBOT_BUILD_ID__", buildId).replace("__OPENBOT_APP_NAME__", appName),
        );
      }
      if (pathname.startsWith("/assets/")) {
        headers.set("cache-control", "no-store");
        const entry = traffic.get(phase) ?? { requests: 0, bytes: 0 };
        entry.requests += 1;
        entry.bytes += body.byteLength;
        traffic.set(phase, entry);
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
    setPhase: (value: string) => {
      phase = value;
    },
    setBuild: (value: "a" | "b") => {
      build = value;
    },
    traffic: (name: string): Traffic => traffic.get(name) ?? { requests: 0, bytes: 0 },
  };
}

// Browser

async function waitForSignIn(page: Page): Promise<void> {
  await page.locator("input[type=email]").first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

/** Every cache entry of this origin, by cache name. */
async function cacheEntries(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const key of await caches.keys())
      result[key] = (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname);
    return result;
  });
}

interface Run {
  browser: string;
  variant: Variant;
  proxy: Awaited<ReturnType<typeof startProxy>>;
  page: Page;
  pageAssetRequests: Map<string, number>;
  phase: string;
  cachedOnA?: Record<string, string[]>;
  error?: string;
}

function setPhase(run: Run, phase: string): void {
  run.phase = phase;
  run.proxy.setPhase(phase);
}

/** Build A: first visit, a reload under the worker that fills its cache, and a warm reload. */
async function visitBuildA(run: Run): Promise<void> {
  const { page } = run;
  setPhase(run, "first-visit");
  await page.goto(`${run.proxy.url}/app`, { waitUntil: "load" });
  await waitForSignIn(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  setPhase(run, "fill");
  await page.reload({ waitUntil: "load" });
  await waitForSignIn(page);
  setPhase(run, "warm-reload");
  await page.reload({ waitUntil: "load" });
  await waitForSignIn(page);
  run.cachedOnA = await cacheEntries(page);
}

/** Build B: the update check, the prompt, "Reload", and the load under the new worker. */
async function deployBuildB(run: Run, screenshot: string | null): Promise<void> {
  const { page } = run;
  run.proxy.setBuild("b");
  setPhase(run, "update-check");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration("/app"))?.update();
  });
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistration("/app"))?.waiting?.state === "installed",
    undefined,
    { timeout: 30_000 },
  );
  const toast = page.getByText("A new version is ready");
  await toast.waitFor({ timeout: 15_000 });
  if (screenshot) await page.screenshot({ path: resolve(OUT, screenshot), animations: "disabled" });
  setPhase(run, "after-deploy");
  const reloaded = page.waitForEvent("load", { timeout: 30_000 });
  await page.getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await waitForSignIn(page);
  setPhase(run, "done");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  restoreDist();
  if (process.argv.includes("--build") || !existsSync(BUILD_A) || !existsSync(BUILD_B)) makeBuilds();
  const a = readBuild(BUILD_A);
  const b = readBuild(BUILD_B);
  const beforeRef = option("before-ref") ?? DEFAULT_BEFORE_REF;
  const beforeTemplate = execFileSync("git", ["show", `${beforeRef}:apps/auth-api/service-worker/app-sw.js`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.ok(!beforeTemplate.includes("__OPENBOT_ASSET_PATHS__"), `${beforeRef} already has the shared asset cache`);
  const bAssets = new Set(b.assets);
  const sameAssets = a.assets.filter((path) => bAssets.has(path));

  const browserNames = (option("browsers") ?? "chromium,webkit").split(",").filter(Boolean);
  const types: Record<string, BrowserType> = { chromium, webkit };
  const state = { upstream: "" };
  const browsers: Browser[] = [];
  const proxies: Server[] = [];
  const runs: Run[] = [];
  let preview = await startPreview(BUILD_A);
  try {
    state.upstream = preview.url;
    for (const name of browserNames) {
      const type = types[name];
      assert.ok(type, `unknown browser ${name}`);
      const browser = await type.launch();
      browsers.push(browser);
      for (const variant of VARIANTS) {
        const proxy = await startProxy(
          state,
          (build) => variant === "before" || (variant === "upgrade" && build === "a"),
          beforeTemplate,
        );
        proxies.push(proxy.server);
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        const run: Run = { browser: name, variant, proxy, page, pageAssetRequests: new Map(), phase: "" };
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/assets/"))
            run.pageAssetRequests.set(run.phase, (run.pageAssetRequests.get(run.phase) ?? 0) + 1);
        });
        runs.push(run);
        runsByKey.set(`${name} ${variant}`, run);
        process.stdout.write(`${name} ${variant}: build A\n`);
        await visitBuildA(run).catch((error: unknown) => {
          run.error = `build A: ${String(error)}`;
        });
      }
    }

    // The deploy: the server now serves build B.
    await preview.stop();
    preview = await startPreview(BUILD_B);
    state.upstream = preview.url;
    for (const run of runs) {
      if (run.error) continue;
      process.stdout.write(`${run.browser} ${run.variant}: build B\n`);
      const shot = run.variant === "after" ? `${run.browser}-update-prompt.png` : null;
      await deployBuildB(run, shot).catch((error: unknown) => {
        run.error = `build B: ${String(error)}`;
      });
      if (!run.error && run.variant === "after")
        await run.page.screenshot({ path: resolve(OUT, `${run.browser}-after-reload.png`) });
    }

    for (const run of runs) await verify(run, a, b);
  } finally {
    for (const browser of browsers) await browser.close().catch(() => undefined);
    for (const server of proxies) server.close();
    await preview.stop();
    restoreDist();
  }

  const results = runs.map((run) => {
    const phase = (name: string) => ({
      network: run.proxy.traffic(name),
      pageRequests: run.pageAssetRequests.get(name) ?? 0,
    });
    return {
      browser: run.browser,
      variant: run.variant,
      error: run.error ?? null,
      firstVisit: phase("first-visit"),
      fill: phase("fill"),
      warmReload: phase("warm-reload"),
      updateCheck: phase("update-check"),
      afterDeploy: phase("after-deploy"),
    };
  });
  const failed = checks.filter((item) => !item.ok);
  const report = {
    createdAt: new Date().toISOString(),
    beforeRef,
    builds: {
      a: { buildId: a.buildId, assets: a.assets.length },
      b: { buildId: b.buildId, assets: b.assets.length },
      sameNames: sameAssets.length,
      change: `${CATALOG_FROM} -> ${CATALOG_TO} in packages/i18n/src/messages/de/common.ts`,
    },
    note: "network = /assets/* requests that reached the server (bytes uncompressed); pageRequests = /assets/* requests the page made, from the worker cache or the network.",
    summary: results.map((item) => ({
      browser: item.browser,
      variant: item.variant,
      afterDeployNetworkRequests: item.afterDeploy.network.requests,
      afterDeployNetworkKB: Math.round(item.afterDeploy.network.bytes / 1024),
      afterDeployPageRequests: item.afterDeploy.pageRequests,
      warmReloadNetworkRequests: item.warmReload.network.requests,
      error: item.error,
    })),
    results,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.summary) process.stdout.write(`${JSON.stringify(row)}\n`);
  process.stdout.write(
    `${checks.length - failed.length}/${checks.length} checks passed. Report: ${resolve(OUT, "report.json")}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

async function verify(run: Run, a: BuildInfo, b: BuildInfo): Promise<void> {
  const label = `${run.browser} ${run.variant}`;
  await check(`${label}: the case ran to the end`, () => {
    assert.equal(run.error, undefined, run.error);
  });
  if (run.error) return;
  await check(`${label}: a warm reload on build A downloads no asset`, () => {
    const network = run.proxy.traffic("warm-reload");
    assert.equal(network.requests, 0, `${network.requests} asset requests reached the server`);
    return { pageRequests: run.pageAssetRequests.get("warm-reload") ?? 0 };
  });
  if (run.variant === "before") return;
  const page = run.page;
  // Probes first, so that the check below also sees whether the worker kept any of them.
  await page.evaluate(async () => {
    for (const path of ["/v1/e2e-sw-probe", "/v2/e2e-sw-probe", "/api/e2e-sw-probe"])
      await fetch(path).catch(() => null);
  });
  const entries = await cacheEntries(page);
  await check(`${label}: only the shell of build B and the shared asset cache remain`, () => {
    // Other caches of the origin, such as the agent pictures, belong to the page, not to the worker.
    const workerCaches = Object.keys(entries).filter((name) => name.startsWith("openbot-web-"));
    assert.deepEqual(workerCaches.sort(), [SHARED_ASSET_CACHE, `openbot-web-shell-${b.buildId}`].sort());
    assert.deepEqual(entries[`openbot-web-shell-${b.buildId}`], ["/app"]);
    const probes = Object.values(entries)
      .flat()
      .filter((path) => path.includes("e2e-sw-probe"));
    assert.deepEqual(probes, [], "an API answer was cached");
    return { caches: Object.keys(entries) };
  });
  await check(`${label}: the asset cache holds only files of build B, and only /assets/*`, () => {
    const assets = entries[SHARED_ASSET_CACHE] ?? [];
    const bAssets = new Set(b.assets);
    const extra = assets.filter((path) => !bAssets.has(path));
    assert.deepEqual(extra, []);
    assert.ok(assets.every((path) => path.startsWith("/assets/")));
    assert.ok(assets.length > 0, "the asset cache is empty");
    return { entries: assets.length };
  });
  await check(`${label}: the files of build A that build B does not use were removed`, () => {
    const cachedOnA = Object.entries(run.cachedOnA ?? {})
      .filter(([name]) => !name.startsWith("openbot-web-shell-"))
      .flatMap(([, paths]) => paths);
    const bAssets = new Set(b.assets);
    const unused = cachedOnA.filter((path) => !bAssets.has(path));
    const aAssets = new Set(a.assets);
    assert.ok(unused.length > 0, "build A had no cached file that build B drops: the case proves nothing");
    assert.ok(unused.every((path) => aAssets.has(path)));
    const left = new Set(Object.values(entries).flat());
    assert.deepEqual(
      unused.filter((path) => left.has(path)),
      [],
    );
    return { removed: unused.length, cachedOnA: cachedOnA.length };
  });
  const before = runsByKey.get(`${run.browser} before`);
  await check(`${label}: the load after the deploy downloads fewer assets than before`, () => {
    assert.ok(before, "no before case");
    const now = run.proxy.traffic("after-deploy");
    const then = before.proxy.traffic("after-deploy");
    assert.ok(now.requests < then.requests, `${now.requests} requests now, ${then.requests} before`);
    return { requests: { before: then.requests, now: now.requests }, bytes: { before: then.bytes, now: now.bytes } };
  });
}

const runsByKey = new Map<string, Run>();

await main();
