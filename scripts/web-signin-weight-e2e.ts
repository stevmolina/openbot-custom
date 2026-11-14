// Measures how much JavaScript the signed-in web client at `/app` downloads, and how long it takes to
// show the first chat, in WebKit with the iPhone and iPad layouts. Writes
// .openbot-build/web-signin-weight/<label>/report.json, and screenshots and a video when asked.
//
// It needs the local account service and a local host: start this worktree's `bun run dev`, which
// seeds the showcase host, and pass the account service address that the stack log prints. Build the
// web client as production does with `bun run api:build` first.
//
// The script copies that build to `<label>/build` and serves it from a local proxy: the page and its
// files come from the copy, gzipped as the production edge sends them, and the API calls go to the
// account service of the stack. So a build of one commit can be measured again after a build of
// another one (`--reuse-build`). The proxy adds a mobile network by default: 150 ms of round trip and
// 1.6 Mbit/s shared by all files (`--throttle=none` turns it off). WebKit has no CPU throttling.
//
// For each layout and run it opens `/app` in a new browser context with the saved session and an
// empty cache, and records:
// - `workspaceJs`: the JS files that loaded before the workspace showed (`openbot:remote-first-screen`),
// - `firstChatJs`: the JS files that loaded before the first chat showed, with its composer on screen.
//   A phone shows the chat list first, so the script taps the first chat in the list,
// - `idleJs`: the JS files that loaded until the network was quiet for 2 s after that,
// - the times of the `openbot:remote-*` marks and of the visible chat, from the start of navigation.
// Byte counts are of the gzipped files, as a phone downloads them. Medians are over the runs.
//
// `bun scripts/web-signin-weight-e2e.ts --api=<account service url> [--label=after] [--runs=3]
//  [--devices=iphone,ipad] [--throttle=mobile|none] [--reuse-build] [--compare=<other report.json>]
//  [--screens] [--video] [--email=openbot-dev-host@example.com]`
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, type BrowserContext, devices, type Page, webkit } from "playwright-core";
import { median } from "./dev-automation/bench-stats";

const logger = createOpenBotLogger("web-signin-weight-e2e");
const english = translateFor("en");
const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const DIST_CLIENT = resolve(API_DIR, "dist/client");

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const apiOption = option("api")?.replace(/\/$/, "");
assert.ok(apiOption, "Pass --api=<url> of the account service that `bun run dev` prints.");
const api: string = apiOption;
const label = option("label") ?? "current";
assert.match(label, /^\w[\w.-]*$/, "--label takes a folder name, not a path.");
const runs = Number(option("runs") ?? "3");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const throttle = option("throttle") ?? "mobile";
assert.ok(throttle === "mobile" || throttle === "none", "--throttle takes mobile or none.");
const email = option("email") ?? "openbot-dev-host@example.com";
const comparePath = option("compare");
const OUT_ROOT = resolve(ROOT, ".openbot-build", "web-signin-weight");
const OUT = resolve(OUT_ROOT, label);
const BUILD = resolve(OUT, "build");
const STORAGE = resolve(OUT_ROOT, "session.json");

const DEVICES = {
  iphone: devices["iPhone 15 Pro"],
  ipad: devices["iPad Pro 11 landscape"],
} as const;
type DeviceName = keyof typeof DEVICES;
const isDeviceName = (name: string): name is DeviceName => name in DEVICES;
const deviceNames = (option("devices") ?? "iphone,ipad").split(",").filter(isDeviceName);
assert.ok(deviceNames.length > 0, "--devices takes iphone, ipad or both.");

const UI_WAIT_MS = 90_000;
const LATENCY_MS = 75; // each way, so 150 ms of round trip
const BYTES_PER_MS = (1.6 * 1024 * 1024) / 8 / 1000;

// ---------------------------------------------------------------- build copy

async function waitForOk(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    assert.ok(child.exitCode === null, "vite preview stopped during startup.");
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    assert.ok(Date.now() < deadline, `${url} did not answer in 60 s.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  return address.port;
}

/** Copies the last build, and the `/app` page that `vite preview` of it renders. */
async function copyBuild(): Promise<void> {
  assert.ok(existsSync(resolve(DIST_CLIENT, "assets")), `No build at ${DIST_CLIENT}. Run \`bun run api:build\` first.`);
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((done) => probe.close(() => done()));
  const child = spawn("bunx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: API_DIR,
    detached: true,
    stdio: "ignore",
  });
  try {
    await waitForOk(`http://127.0.0.1:${port}/app`, child);
    const page = await (await fetch(`http://127.0.0.1:${port}/app`)).text();
    rmSync(BUILD, { recursive: true, force: true });
    mkdirSync(BUILD, { recursive: true });
    cpSync(resolve(DIST_CLIENT, "assets"), resolve(BUILD, "assets"), { recursive: true });
    for (const file of readdirSync(DIST_CLIENT)) {
      if (/\.(js|json|webmanifest|ico|png)$/.test(file)) cpSync(resolve(DIST_CLIENT, file), resolve(BUILD, file));
    }
    writeFileSync(resolve(BUILD, "app.html"), page);
    writeFileSync(resolve(BUILD, "commit.txt"), gitCommit());
  } finally {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

function gitCommit(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return dirty.trim() ? `${head}+changes` : head;
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------- proxy

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
const COMPRESSIBLE = new Set([".js", ".css", ".json", ".svg", ".webmanifest", ".html"]);

/** The gzipped size of each file of the copy, as the edge sends it. */
const gzipSizes = new Map<string, number>();
function gzipped(path: string, raw: Buffer): Buffer {
  const body = gzipSync(raw, { level: 6 });
  gzipSizes.set(path, body.byteLength);
  return body;
}

/** One link for all responses: a file waits for the files before it, as on a slow mobile network. */
let linkFreeAt = 0;
async function throttled(bytes: number): Promise<void> {
  if (throttle === "none") return;
  const start = Math.max(Date.now() + LATENCY_MS * 2, linkFreeAt);
  linkFreeAt = start + bytes / BYTES_PER_MS;
  await new Promise((done) => setTimeout(done, linkFreeAt - Date.now()));
}

async function readBody(request: IncomingMessage): Promise<Blob | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for await (const chunk of request) chunks.push(new Uint8Array(Buffer.from(chunk)));
  return new Blob(chunks);
}

// WebKit keeps no `Secure` cookie on plain http, and a `__Host-` cookie must be `Secure`. The proxy
// gives the browser the session under another name and turns it back on the way to the service.
const SESSION_COOKIE = "__Host-openbot-web";
const PROXY_COOKIE = "openbot-web-proxy";

async function forward(request: IncomingMessage, response: ServerResponse, upstream: string): Promise<void> {
  const target = new URL(request.url ?? "/", upstream);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ["host", "connection", "accept-encoding", "content-length"].includes(name)) continue;
    if (name === "origin") headers.set(name, upstream);
    else if (name === "cookie") headers.set(name, String(value).replaceAll(`${PROXY_COOKIE}=`, `${SESSION_COOKIE}=`));
    else if (name === "referer") headers.set(name, upstream + new URL(String(value)).pathname);
    else headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const answer = await fetch(target, {
    method: request.method,
    headers,
    body: await readBody(request),
    redirect: "manual",
  });
  const body = Buffer.from(await answer.arrayBuffer());
  const out: [string, string][] = [];
  answer.headers.forEach((value, name) => {
    if (
      !["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "set-cookie"].includes(
        name,
      )
    )
      out.push([name, value]);
  });
  for (const cookie of answer.headers.getSetCookie()) {
    out.push(["set-cookie", cookie.replace(`${SESSION_COOKIE}=`, `${PROXY_COOKIE}=`).replace(/;\s*Secure/i, "")]);
  }
  await throttled(body.byteLength);
  response.writeHead(answer.status, [...out, ["content-length", String(body.byteLength)]].flat());
  response.end(body);
}

async function startProxy(upstream: string): Promise<{ url: string; server: Server }> {
  const page = readFileSync(resolve(BUILD, "app.html"));
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://proxy").pathname;
      if (path === "/app" || path === "/app/") {
        const body = gzipped(path, page);
        await throttled(body.byteLength);
        response
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-encoding": "gzip",
            "cache-control": "no-store",
            "content-length": String(body.byteLength),
          })
          .end(body);
        return;
      }
      const file = resolve(BUILD, `.${path}`);
      if (file.startsWith(`${BUILD}/`) && !file.endsWith("app.html") && existsSync(file) && !path.endsWith("/")) {
        const extension = extname(file);
        const raw = readFileSync(file);
        const compress = COMPRESSIBLE.has(extension);
        const body = compress ? gzipped(path, raw) : raw;
        await throttled(body.byteLength);
        response
          .writeHead(200, {
            "content-type": TYPES[extension] ?? "application/octet-stream",
            "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
            ...(compress ? { "content-encoding": "gzip" } : {}),
            "content-length": String(body.byteLength),
          })
          .end(body);
        return;
      }
      await forward(request, response, upstream);
    })().catch((error: unknown) => {
      logger.warn(`proxy: ${String(error)}`);
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  return { url: `http://127.0.0.1:${await listen(server)}`, server };
}

// ---------------------------------------------------------------- page readings

// Records when the composer of a chat shows on screen, and when the first tap lands, from the start of
// navigation.
const CHAT_OBSERVER = `(() => {
  const state = { chatVisibleMs: null, signInMs: null, tapMs: null };
  window.__openbotWeight = state;
  // The first tap that reaches the page, after any cover over it went.
  addEventListener("click", () => {
    if (state.tapMs === null) state.tapMs = performance.now();
  }, { capture: true });
  const onScreen = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) return false;
    const x = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2));
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (element === hit || element.contains(hit) || hit.contains(element));
  };
  const check = () => {
    if (state.signInMs === null) {
      const input = document.querySelector('input[type="email"]');
      if (input && onScreen(input)) state.signInMs = performance.now();
    }
    if (state.chatVisibleMs !== null) return;
    for (const editor of document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea')) {
      if (onScreen(editor)) {
        state.chatVisibleMs = performance.now();
        return;
      }
    }
  };
  const loop = () => {
    check();
    if (state.chatVisibleMs === null) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})()`;

const READ_PAGE = `(() => {
  const marks = {};
  for (const mark of performance.getEntriesByType("mark")) {
    if (mark.name.startsWith("openbot:remote-") && !(mark.name in marks)) marks[mark.name.slice(15)] = mark.startTime;
  }
  const resources = performance.getEntriesByType("resource").map((entry) => ({
    path: new URL(entry.name).pathname,
    startTime: entry.startTime,
  }));
  const state = window.__openbotWeight;
  return { marks, resources, chatVisibleMs: state.chatVisibleMs, signInMs: state.signInMs, tapMs: state.tapMs };
})()`;

interface PageReading {
  marks: Record<string, number>;
  resources: Array<{ path: string; startTime: number }>;
  chatVisibleMs: number | null;
  signInMs: number | null;
  tapMs: number | null;
}

async function readPage(page: Page): Promise<PageReading> {
  const value = await page.evaluate(READ_PAGE);
  assert.ok(isDynamicRecord(value) && isDynamicRecord(value.marks) && Array.isArray(value.resources));
  const number = (item: unknown) => (typeof item === "number" ? item : null);
  return {
    marks: Object.fromEntries(
      Object.entries(value.marks).flatMap(([name, at]) => (typeof at === "number" ? [[name, at]] : [])),
    ),
    resources: value.resources.flatMap((entry: unknown) =>
      isDynamicRecord(entry) && typeof entry.path === "string" && typeof entry.startTime === "number"
        ? [{ path: entry.path, startTime: entry.startTime }]
        : [],
    ),
    chatVisibleMs: number(value.chatVisibleMs),
    signInMs: number(value.signInMs),
    tapMs: number(value.tapMs),
  };
}

interface JsTotals {
  files: number;
  gzipKB: number;
  rawKB: number;
  chunks: Record<string, number>;
}

/** The JS files that the page asked for before `untilMs`, with their gzipped sizes. */
function jsBefore(reading: PageReading, untilMs: number): JsTotals {
  const totals: JsTotals = { files: 0, gzipKB: 0, rawKB: 0, chunks: {} };
  const seen = new Set<string>();
  for (const resource of reading.resources) {
    if (!resource.path.endsWith(".js") || resource.startTime > untilMs || seen.has(resource.path)) continue;
    seen.add(resource.path);
    const file = resolve(BUILD, `.${resource.path}`);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file);
    const gzip = gzipSizes.get(resource.path) ?? gzipSync(raw, { level: 6 }).byteLength;
    totals.files += 1;
    totals.gzipKB += gzip / 1024;
    totals.rawKB += raw.byteLength / 1024;
    totals.chunks[resource.path.replace(/^\/assets\//, "")] = Math.round(gzip / 102.4) / 10;
  }
  totals.gzipKB = Math.round(totals.gzipKB);
  totals.rawKB = Math.round(totals.rawKB);
  return totals;
}

/** Waits until no request is open for 500 ms. A request that stays open, such as a poll, does not fail the run. */
async function quiet(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------- flows

function newContext(browser: Browser, device: DeviceName, storage: boolean, video?: string): Promise<BrowserContext> {
  return browser.newContext({
    ...DEVICES[device],
    serviceWorkers: "block",
    ...(storage ? { storageState: STORAGE } : {}),
    ...(video ? { recordVideo: { dir: video, size: DEVICES[device].viewport } } : {}),
  });
}

/** Signs in once with the development code that the local account service shows, and saves the session. */
async function signIn(browser: Browser, url: string): Promise<void> {
  const context = await newContext(browser, "iphone", false);
  const page = await context.newPage();
  try {
    await page.goto(`${url}/app`);
    await page.getByRole("textbox", { name: english("account.login.email") }).fill(email);
    await page.getByRole("button", { name: english("account.login.sendCode") }).click();
    const codeLine = page.getByText(/^Development code: /);
    await codeLine.waitFor({ timeout: UI_WAIT_MS });
    const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
    assert.ok(code && code.length === 8, "The page shows no development code.");
    await page.keyboard.type(code);
    await page.waitForFunction("performance.getEntriesByName('openbot:remote-first-screen').length > 0", undefined, {
      timeout: UI_WAIT_MS,
    });
    await context.storageState({ path: STORAGE });
  } catch (error) {
    await page.screenshot({ path: resolve(OUT, "sign-in-failure.png") }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

/** The first chat of the phone's chat list. A chat row is named "<chat>. <last message>". */
function firstChatRow(page: Page) {
  return page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: /^[^.]+\.\s/ })
    .first();
}

interface RunReading {
  marks: Record<string, number>;
  chatVisibleMs: number;
  /** When the phone's tap on the first chat landed. Playwright taps once the row can take it. */
  tapMs: number | null;
  workspaceJs: JsTotals;
  firstChatJs: JsTotals;
  idleJs: JsTotals;
}

async function measureOnce(browser: Browser, url: string, device: DeviceName, video?: string): Promise<RunReading> {
  const context = await newContext(browser, device, true, video);
  const page = await context.newPage();
  try {
    await page.addInitScript(CHAT_OBSERVER);
    linkFreeAt = 0;
    await page.goto(`${url}/app`, { waitUntil: "commit" });
    await page.waitForFunction("performance.getEntriesByName('openbot:remote-first-screen').length > 0", undefined, {
      timeout: UI_WAIT_MS,
    });
    let reading = await readPage(page);
    if (reading.chatVisibleMs === null && device === "iphone") {
      // A phone shows the chat list first. The user taps the first chat.
      await firstChatRow(page).click({ timeout: UI_WAIT_MS });
    }
    await page.waitForFunction("window.__openbotWeight.chatVisibleMs !== null", undefined, { timeout: UI_WAIT_MS });
    await quiet(page);
    await page.waitForTimeout(2_000);
    await quiet(page);
    reading = await readPage(page);
    const chatVisibleMs = reading.chatVisibleMs ?? 0;
    const firstScreen = reading.marks["first-screen"] ?? chatVisibleMs;
    return {
      marks: Object.fromEntries(Object.entries(reading.marks).map(([name, value]) => [name, Math.round(value)])),
      chatVisibleMs: Math.round(chatVisibleMs),
      tapMs: reading.tapMs === null ? null : Math.round(reading.tapMs),
      workspaceJs: jsBefore(reading, firstScreen),
      firstChatJs: jsBefore(reading, chatVisibleMs),
      idleJs: jsBefore(reading, Number.POSITIVE_INFINITY),
    };
  } catch (error) {
    await page.screenshot({ path: resolve(OUT, `${device}-failure.png`) }).catch(() => undefined);
    const tree = await page
      .locator("body")
      .ariaSnapshot()
      .catch(() => "");
    writeFileSync(resolve(OUT, `${device}-failure.yml`), tree);
    throw error;
  } finally {
    await context.close();
  }
}

/** The signed-out sign-in page, for reference: the JS that shows the email field. */
async function measureSignedOut(browser: Browser, url: string, device: DeviceName): Promise<JsTotals & { ms: number }> {
  const context = await newContext(browser, device, false);
  const page = await context.newPage();
  try {
    await page.addInitScript(CHAT_OBSERVER);
    linkFreeAt = 0;
    await page.goto(`${url}/app`, { waitUntil: "commit" });
    await page.waitForFunction("window.__openbotWeight.signInMs !== null", undefined, { timeout: UI_WAIT_MS });
    await quiet(page);
    const reading = await readPage(page);
    return { ...jsBefore(reading, reading.signInMs ?? 0), ms: Math.round(reading.signInMs ?? 0) };
  } finally {
    await context.close();
  }
}

/** Records the phone opening to its chat list without exposing provider status in a chat. */
async function recordOpening(browser: Browser, url: string, folder: string): Promise<void> {
  const context = await newContext(browser, "iphone", true, folder);
  const page = await context.newPage();
  try {
    linkFreeAt = 0;
    await page.goto(`${url}/app`, { waitUntil: "commit" });
    await page.waitForFunction("performance.getEntriesByName('openbot:remote-first-screen').length > 0", undefined, {
      timeout: UI_WAIT_MS,
    });
    await firstChatRow(page).waitFor({ state: "visible", timeout: UI_WAIT_MS });
    // Leave the finished screen visible in the recording for the viewer.
    await page.waitForTimeout(1_000);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- report

interface DeviceSummary {
  runs: RunReading[];
  signedOut: JsTotals & { ms: number };
  median: {
    workspaceJsKB: number;
    workspaceJsFiles: number;
    firstChatJsKB: number;
    firstChatJsFiles: number;
    idleJsKB: number;
    chatVisibleMs: number;
    marks: Record<string, number>;
  };
}

interface Report {
  label: string;
  commit: string;
  createdAt: string;
  throttle: string;
  runs: number;
  devices: Partial<Record<DeviceName, DeviceSummary>>;
}

function summarize(readings: RunReading[], signedOut: JsTotals & { ms: number }): DeviceSummary {
  const markNames = new Set(readings.flatMap((reading) => Object.keys(reading.marks)));
  return {
    runs: readings,
    signedOut,
    median: {
      workspaceJsKB: median(readings.map((reading) => reading.workspaceJs.gzipKB)),
      workspaceJsFiles: median(readings.map((reading) => reading.workspaceJs.files)),
      firstChatJsKB: median(readings.map((reading) => reading.firstChatJs.gzipKB)),
      firstChatJsFiles: median(readings.map((reading) => reading.firstChatJs.files)),
      idleJsKB: median(readings.map((reading) => reading.idleJs.gzipKB)),
      chatVisibleMs: median(readings.map((reading) => reading.chatVisibleMs)),
      marks: Object.fromEntries(
        [...markNames].map((name) => [name, median(readings.flatMap((reading) => reading.marks[name] ?? []))]),
      ),
    },
  };
}

const MEDIAN_KEYS = [
  "workspaceJsKB",
  "workspaceJsFiles",
  "firstChatJsKB",
  "firstChatJsFiles",
  "idleJsKB",
  "chatVisibleMs",
] as const;
type Medians = Record<(typeof MEDIAN_KEYS)[number], number>;

/** The medians of one layout in a report that this script wrote, read back from its JSON. */
function mediansOf(report: unknown, device: DeviceName): Medians | undefined {
  if (!isDynamicRecord(report) || !isDynamicRecord(report.devices)) return undefined;
  const summary = report.devices[device];
  if (!isDynamicRecord(summary) || !isDynamicRecord(summary.median)) return undefined;
  const values = summary.median;
  const read = (key: (typeof MEDIAN_KEYS)[number]) => {
    const value = values[key];
    return isNumber(value) ? value : Number.NaN;
  };
  const medians: Medians = {
    workspaceJsKB: read("workspaceJsKB"),
    workspaceJsFiles: read("workspaceJsFiles"),
    firstChatJsKB: read("firstChatJsKB"),
    firstChatJsFiles: read("firstChatJsFiles"),
    idleJsKB: read("idleJsKB"),
    chatVisibleMs: read("chatVisibleMs"),
  };
  return Object.values(medians).every(Number.isFinite) ? medians : undefined;
}

function compareTable(before: unknown, after: unknown): string {
  const rows = ["| Layout | Metric | Before | After |", "| --- | --- | --- | --- |"];
  for (const device of deviceNames) {
    const old = mediansOf(before, device);
    const now = mediansOf(after, device);
    if (!old || !now) continue;
    rows.push(
      `| ${device} | JS at sign-in (gzip KB, files) | ${old.workspaceJsKB}, ${old.workspaceJsFiles} | ${now.workspaceJsKB}, ${now.workspaceJsFiles} |`,
    );
    rows.push(
      `| ${device} | JS to first chat (gzip KB, files) | ${old.firstChatJsKB}, ${old.firstChatJsFiles} | ${now.firstChatJsKB}, ${now.firstChatJsFiles} |`,
    );
    rows.push(`| ${device} | JS after 2 s idle (gzip KB) | ${old.idleJsKB} | ${now.idleJsKB} |`);
    rows.push(`| ${device} | Time to first chat (ms) | ${old.chatVisibleMs} | ${now.chatVisibleMs} |`);
  }
  return rows.join("\n");
}

// ---------------------------------------------------------------- screens

/** Screenshots of the chat, settings, marketplace, tasks and workflows on a phone. */
async function captureScreens(browser: Browser, url: string): Promise<string[]> {
  const folder = resolve(OUT, "screens");
  mkdirSync(folder, { recursive: true });
  const context = await newContext(browser, "iphone", true);
  const page = await context.newPage();
  await page.addInitScript(CHAT_OBSERVER);
  const shots: string[] = [];
  const shot = async (name: string) => {
    await quiet(page);
    await page.waitForTimeout(1_000);
    const path = join(folder, `${name}.png`);
    await page.screenshot({ path });
    shots.push(path);
  };
  const tab = (name: string) =>
    page.getByRole("navigation", { name: english("webClient.pane.navigation") }).getByRole("button", { name });
  try {
    await page.goto(`${url}/app`);
    await page.waitForFunction("performance.getEntriesByName('openbot:remote-first-screen').length > 0", undefined, {
      timeout: UI_WAIT_MS,
    });
    await shot("chats");
    await firstChatRow(page).click();
    await page.waitForFunction("window.__openbotWeight.chatVisibleMs !== null", undefined, { timeout: UI_WAIT_MS });
    await shot("chat");
    await page.getByRole("button", { name: english("common.back") }).click();
    await tab(english("app.rail.tasks")).click();
    await shot("tasks");
    await tab(english("app.rail.workflows")).click();
    await shot("workflows");
    await tab(english("webClient.tab.settings")).click();
    await shot("settings");
    // Billing loads its code when it first opens.
    await page
      .getByRole("button", { name: english("billing.title"), exact: true })
      .first()
      .click();
    await shot("billing");
    await page.keyboard.press("Escape");
    // Billing closes over the last chat. Back shows the chat list.
    await page.getByRole("button", { name: english("common.back") }).click();
    await page
      .getByRole("button", { name: english("app.rail.more"), exact: true })
      .first()
      .click();
    await page
      .getByRole("menuitem", { name: english("app.rail.marketplace") })
      .first()
      .click();
    await shot("marketplace");
  } catch (error) {
    await page.screenshot({ path: join(folder, "failure.png") }).catch(() => undefined);
    writeFileSync(
      join(folder, "failure.yml"),
      await page
        .locator("body")
        .ariaSnapshot()
        .catch(() => ""),
    );
    throw error;
  } finally {
    await context.close();
  }
  return shots;
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (!flag("reuse-build") || !existsSync(resolve(BUILD, "app.html"))) await copyBuild();
  const proxy = await startProxy(api);
  const browser = await webkit.launch();
  try {
    if (!existsSync(STORAGE)) await signIn(browser, proxy.url);
    const report: Report = {
      label,
      commit: readFileSync(resolve(BUILD, "commit.txt"), "utf8"),
      createdAt: new Date().toISOString(),
      throttle,
      runs,
      devices: {},
    };
    for (const device of deviceNames) {
      // One load warms the account service and the host, so the first run is not an outlier.
      await measureOnce(browser, proxy.url, device);
      const readings: RunReading[] = [];
      for (let run = 0; run < runs; run++) {
        readings.push(await measureOnce(browser, proxy.url, device));
        logger.info(
          `${device} run ${run + 1}: ${JSON.stringify(readings.at(-1)?.chatVisibleMs)} ms to the first chat.`,
        );
      }
      report.devices[device] = summarize(readings, await measureSignedOut(browser, proxy.url, device));
    }
    if (flag("video")) {
      const folder = resolve(OUT, "video");
      rmSync(folder, { recursive: true, force: true });
      await recordOpening(browser, proxy.url, folder);
      const [webm] = readdirSync(folder).filter((file) => file.endsWith(".webm"));
      if (webm) renameSync(join(folder, webm), join(folder, "iphone-first-chat.webm"));
    }
    const shots = flag("screens") ? await captureScreens(browser, proxy.url) : [];
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    for (const device of deviceNames) logger.info(`${device}: ${JSON.stringify(report.devices[device]?.median)}`);
    if (shots.length) logger.info(`Screenshots: ${shots.join(", ")}`);
    if (comparePath) {
      const before = JSON.parse(readFileSync(resolve(comparePath), "utf8"));
      assert.ok(mediansOf(before, deviceNames[0] ?? "iphone"), "--compare takes a report.json of this script.");
      const table = compareTable(before, report);
      writeFileSync(resolve(OUT, "compare.md"), `${table}\n`);
      logger.info(`\n${table}`);
    }
    logger.info(`Report: ${resolve(OUT, "report.json")}`);
  } finally {
    await browser.close();
    proxy.server.close();
  }
}

await main();
