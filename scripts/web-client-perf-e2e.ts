// Measures the web client at `/app` in five phases and writes .openbot-build/<out>/report.json.
//
// - bundle: JS and CSS bytes (raw and gzip) of the chunks that `/app` loads, from the Vite manifest of
//   the last `bun run api:build`, and the style rules in that CSS. `cssEveryElementRules` counts the
//   selectors that match every element or its `::before` or `::after`, such as `*` or `::before`.
//   WebKit tests those for each element at each style change, and with `::before` or `::after` it also
//   resolves both pseudo-elements of every element.
// - load: cold and warm loads of the signed-out `/app` in Chrome, with mobile CPU and network
//   throttling, until the sign-in form shows. The script starts `vite preview` of that build (no
//   secrets), or uses `--url`. A local gzip proxy sits in front, because `vite preview` sends assets
//   uncompressed and production does not. Without secrets the preview cannot check a session, so the
//   proxy answers the session check as production answers a visitor with no cookie.
// - runtime: the `Web/Workspace/LongConversation` story of a running Storybook (`--storybook=<url>`).
//   It streams a reply into a 160-message conversation and counts the host requests per turn and per
//   window focus. Storybook runs development builds, so compare its times only with each other.
// - style: the same story in WebKit with the iPad and iPhone layouts of Safari. `rootVarMs` is the
//   style time of one custom property change on the app root, which every element inherits.
//   `keyboard.*` plays a keyboard that opens over 20 frames and then pans for 10, as iOS reports it
//   through `visualViewport`, into the real `web-visual-viewport.ts`. `styleMs` is the style and
//   layout time that each frame's change needs; `frameMs` and `framesOver20Ms` are the frame times,
//   which also include other work on the main thread.
//   It needs `--storybook=<url>` too.
// - look: the signed-out screens of `/app` (sign-in, a wrong email, the analytics box ticked while its
//   avatars pop, the code step and a wrong code with and without the full stylesheet, the account
//   service down) in a desktop and a phone layout, dark and light, from `vite preview` of the
//   last build or `--url`. It saves each element's computed style and a screenshot to `<out>/look/`.
//   `--compare-look=<folder>` fails on any property that differs from that folder, except the ones in
//   `--allow-look`. `signInSheetsOn` counts the sign-in stylesheets that are on.
//
// `bun run perf:web [--runs=5] [--storybook=<url>] [--url=<preview url>] [--out=<folder>]
//  [--compare=<old report.json>] [--phases=bundle,load,runtime,style,look] [--throttle=mobile|none]
//  [--compare-look=<old out folder>/look] [--allow-look=<property>,...]`
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, type BrowserContext, chromium, devices, type Page, webkit } from "playwright-core";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { startRenderRecording } from "./dev-automation/render-metrics";

const logger = createOpenBotLogger("web-client-perf-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const CLIENT_DIR = resolve(API_DIR, "dist/client");
const MANIFEST = resolve(CLIENT_DIR, ".vite/manifest.json");

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const runs = Number(option("runs") ?? "5");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const outName = option("out") ?? "web-client-perf";
assert.match(outName, /^\w[\w.-]*$/, "--out takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", outName);
const phases = new Set((option("phases") ?? "bundle,load,runtime").split(","));
const throttle = option("throttle") ?? "mobile";
assert.ok(throttle === "mobile" || throttle === "none", "--throttle takes mobile or none.");
const storybook = option("storybook")?.replace(/\/$/, "");
const comparePath = option("compare");
const browserExecutable = option("browser-executable");

// One metric: the value of each run, reduced to a median with its range.
type Samples = Record<string, number[]>;
interface Report {
  label: string;
  createdAt: string;
  commit: string;
  runs: number;
  throttle: string;
  metrics: Record<string, Spread>;
}

function record(samples: Samples, key: string, value: number): void {
  const values = samples[key] ?? [];
  values.push(Math.round(value * 10) / 10);
  samples[key] = values;
}

// ---------------------------------------------------------------- bundle

interface ManifestChunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

const WEB_APP_KEY = "../../src/renderer/src/features/web-client/WebApp.tsx";
const WEB_WORKSPACE_KEY = "../../src/renderer/src/features/web-client/WebWorkspace.tsx";
const APP_ROUTE_KEY = "src/routes/app.lazy.tsx";
// The full web client stylesheet, when it loads with the workspace and not with the route.
const WEB_CLIENT_CSS_KEY = "../../src/renderer/src/features/web-client/web-client.css";

function readManifest(): Record<string, ManifestChunk> {
  assert.ok(existsSync(MANIFEST), `No Vite manifest at ${MANIFEST}. Run \`bun run api:build\` first.`);
  const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"));
  assert.ok(isDynamicRecord(parsed), "The Vite manifest is not an object.");
  const manifest: Record<string, ManifestChunk> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isDynamicRecord(value) || typeof value.file !== "string") continue;
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
    manifest[key] = { file: value.file, imports: strings(value.imports), css: strings(value.css) };
    if (value.isEntry === true) manifest[key].isEntry = true;
  }
  return manifest;
}

/** The style rules of a built stylesheet, and the selectors among them that match every element. */
function countRules(css: string): { rules: number; everyElement: number } {
  let rules = 0;
  let everyElement = 0;
  let prelude = "";
  // One entry per open block: true for a block of declarations or keyframe steps.
  const blocks: boolean[] = [];
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '"' || char === "'") {
      const end = css.indexOf(char, index + 1);
      prelude += css.slice(index, end + 1);
      index = end;
    } else if (char === "/" && css[index + 1] === "*") {
      index = css.indexOf("*/", index + 2) + 1;
    } else if (char === "{") {
      const head = prelude.trim();
      const inKeyframes = blocks.at(-1) === true;
      const styleRule = !head.startsWith("@") && !inKeyframes;
      if (styleRule) {
        rules++;
        for (const selector of head.split(",")) if (/^(\*|\*?::?(before|after))$/.test(selector.trim())) everyElement++;
      }
      blocks.push(styleRule || head.startsWith("@keyframes") || head.startsWith("@-webkit-keyframes"));
      prelude = "";
    } else if (char === "}") {
      blocks.pop();
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return { rules, everyElement };
}

/** The files that load with the given chunks: their static imports, and the CSS of each. */
function closure(manifest: Record<string, ManifestChunk>, keys: readonly string[]): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  for (const key of keys) visit(key);
  return files;
}

function measureBundle(samples: Samples): void {
  const manifest = readManifest();
  const entry = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  assert.ok(entry, "The Vite manifest has no entry chunk.");
  assert.ok(manifest[APP_ROUTE_KEY] && manifest[WEB_APP_KEY], "The manifest has no /app route or WebApp chunk.");
  // With a full stylesheet that loads with the workspace, the route's sign-in stylesheet turns off
  // then: the workspace downloads it, but its rules no longer count.
  const retired = new Set(manifest[WEB_CLIENT_CSS_KEY] ? (manifest[APP_ROUTE_KEY]?.css ?? []) : []);
  const sizes = (files: Set<string>, retiredFiles: ReadonlySet<string> = new Set()) => {
    const totals = {
      js: 0,
      jsGzip: 0,
      css: 0,
      cssGzip: 0,
      files: files.size,
      jsFiles: [...files].filter((file) => file.endsWith(".js")).length,
      cssRules: 0,
      cssEveryElementRules: 0,
    };
    for (const file of files) {
      const content = readFileSync(resolve(CLIENT_DIR, file));
      const kind = file.endsWith(".css") ? "css" : "js";
      totals[kind] += content.byteLength;
      totals[`${kind}Gzip`] += gzipSync(content, { level: 9 }).byteLength;
      if (kind === "css" && !retiredFiles.has(file)) {
        const { rules, everyElement } = countRules(content.toString("utf8"));
        totals.cssRules += rules;
        totals.cssEveryElementRules += everyElement;
      }
    }
    return totals;
  };
  // The sign-in screen needs the entry, the route and the WebApp chunk. The workspace adds its own
  // chunk when it is split off; until then it is part of WebApp.
  const signedOut = closure(manifest, [entry, APP_ROUTE_KEY, WEB_APP_KEY]);
  const workspace = closure(manifest, [entry, APP_ROUTE_KEY, WEB_APP_KEY, WEB_WORKSPACE_KEY, WEB_CLIENT_CSS_KEY]);
  for (const [name, files, retiredFiles] of [
    ["signedOut", signedOut, new Set<string>()],
    ["workspace", workspace, retired],
  ] as const) {
    for (const [metric, value] of Object.entries(sizes(files, retiredFiles))) {
      const count = ["files", "jsFiles", "cssRules", "cssEveryElementRules"].includes(metric);
      record(samples, `bundle.${name}.${metric}${count ? "" : "KB"}`, count ? value : value / 1024);
    }
  }
}

// ---------------------------------------------------------------- load

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  return address.port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

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

/** Starts `vite preview` of the last build, without secrets. Stops only the process group it started. */
async function startPreview(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child = spawn("bunx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: API_DIR,
    detached: true,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  };
  try {
    await waitForOk(`${url}/app`, child);
  } catch (error) {
    stop();
    throw error;
  }
  return { url, stop };
}

const COMPRESSIBLE = /^(text\/|application\/(javascript|json)|image\/svg)/u;

const SIGNED_OUT = JSON.stringify({ error: { code: "sign_in_required", message: "Sign in is required." } });

/** A stand-in answer of the account service: a status and a JSON body. */
type AccountAnswer = { status: number; body: unknown };

/**
 * Gzips what the upstream sends uncompressed, as the production edge does. Keeps one copy per asset.
 * `account` answers `/api/browser/<path>` in place of the account service; without an answer, the
 * session check is signed out.
 */
async function startGzipProxy(
  upstream: string,
  account: (path: string) => AccountAnswer | undefined = () => undefined,
): Promise<{ url: string; server: Server }> {
  const cache = new Map<string, { status: number; headers: [string, string][]; body: Buffer }>();
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? "/";
      const answer = path.startsWith("/api/browser/") ? account(path.slice("/api/browser/".length)) : undefined;
      if (answer) {
        response
          .writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" })
          .end(JSON.stringify(answer.body));
        return;
      }
      if (path === "/api/browser/session") {
        response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end(SIGNED_OUT);
        return;
      }
      let entry = cache.get(path);
      if (!entry) {
        const upstreamResponse = await fetch(`${upstream}${path}`, { redirect: "manual" });
        const raw = Buffer.from(await upstreamResponse.arrayBuffer());
        const type = upstreamResponse.headers.get("content-type") ?? "";
        const headers: [string, string][] = [];
        upstreamResponse.headers.forEach((value, name) => {
          if (!["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"].includes(name))
            headers.push([name, value]);
        });
        const compress = COMPRESSIBLE.test(type);
        const body = compress ? gzipSync(raw, { level: 6 }) : raw;
        if (compress) headers.push(["content-encoding", "gzip"]);
        entry = { status: upstreamResponse.status, headers, body };
        if (path.startsWith("/assets/")) cache.set(path, entry);
      }
      response.writeHead(entry.status, [...entry.headers, ["content-length", String(entry.body.byteLength)]].flat());
      response.end(entry.body);
    })().catch((error: unknown) => {
      logger.warn(`proxy: ${String(error)}`);
      response.writeHead(502).end();
    });
  });
  return { url: `http://127.0.0.1:${await listen(server)}`, server };
}

// Records when the sign-in form shows and the long tasks before it, from the first byte of the page.
const LOAD_OBSERVERS = `(() => {
  const state = { loginMs: null, longTasks: 0, longTaskMs: 0 };
  window.__openbotWebPerf = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (state.loginMs !== null) continue;
      state.longTasks += 1;
      state.longTaskMs += entry.duration;
    }
  }).observe({ type: "longtask", buffered: true });
  const check = () => {
    if (state.loginMs !== null) return;
    const input = document.querySelector('input[type="email"]');
    if (input && input.getBoundingClientRect().width > 0) state.loginMs = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
})()`;

const READ_LOAD = `(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const resources = performance.getEntriesByType("resource");
  let transfer = navigation ? navigation.transferSize : 0;
  let scriptBytes = 0;
  let scripts = 0;
  const loginMs = window.__openbotWebPerf.loginMs ?? 0;
  let loginTransfer = navigation ? navigation.transferSize : 0;
  let loginRequests = 1;
  for (const entry of resources) {
    transfer += entry.transferSize;
    if (entry.startTime < loginMs) {
      loginRequests += 1;
      loginTransfer += entry.transferSize;
    }
    if (entry.name.endsWith(".js")) {
      scripts += 1;
      scriptBytes += entry.encodedBodySize;
    }
  }
  return {
    ttfbMs: navigation ? navigation.responseStart : 0,
    fcpMs: fcp ? fcp.startTime : 0,
    loginMs,
    loginRequests,
    loginTransferKB: loginTransfer / 1024,
    longTasks: window.__openbotWebPerf.longTasks,
    longTaskMs: window.__openbotWebPerf.longTaskMs,
    requests: resources.length + 1,
    transferKB: transfer / 1024,
    scripts,
    scriptKB: scriptBytes / 1024,
  };
})()`;

async function throttlePage(page: Page): Promise<void> {
  if (throttle === "none") return;
  // Lighthouse's mobile profile: a 4x slower CPU, 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up.
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

async function loadOnce(context: BrowserContext, url: string, samples: Samples, prefix: string): Promise<void> {
  const page = await context.newPage();
  try {
    await throttlePage(page);
    await page.addInitScript(LOAD_OBSERVERS);
    await page.goto(`${url}/app`, { waitUntil: "commit" });
    await page.waitForFunction("window.__openbotWebPerf?.loginMs !== null", undefined, { timeout: 120_000 });
    await page.waitForLoadState("networkidle");
    const values = await page.evaluate(READ_LOAD);
    assert.ok(isDynamicRecord(values), "The load reading is not an object.");
    for (const [key, value] of Object.entries(values)) if (isNumber(value)) record(samples, `${prefix}.${key}`, value);
  } finally {
    await page.close();
  }
}

async function measureLoad(browser: Browser, samples: Samples): Promise<void> {
  const preview = option("url") ? null : await startPreview();
  const upstream = option("url")?.replace(/\/$/, "") ?? preview?.url;
  assert.ok(upstream);
  const proxy = await startGzipProxy(upstream);
  try {
    for (let run = 0; run < runs; run++) {
      // A new context has an empty cache: the first load is cold, the second reuses the cached assets.
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        await loadOnce(context, proxy.url, samples, "load.cold");
        await loadOnce(context, proxy.url, samples, "load.warm");
      } finally {
        await context.close();
      }
      logger.info(`load run ${run + 1}/${runs}: login ${samples["load.cold.loginMs"]?.at(-1)} ms cold`);
    }
  } finally {
    proxy.server.close();
    preview?.stop();
  }
}

// ---------------------------------------------------------------- look

// In the page: the computed style of each element and of its `::before` and `::after`, by DOM path.
// A transition or an animation that ends jumps to its end, and one that repeats stops at its start, so
// two builds give the same values for the same screen.
// With `freezeMs`, every animation stops at that time instead, to read a screen while it moves. A
// moving screen also skips what is inside each SVG: script draws it, such as the random agent faces.
const readLook = (freezeMs?: number) => `(async () => {
  await document.fonts.ready;
  const freezeMs = ${JSON.stringify(freezeMs ?? null)};
  for (const animation of document.getAnimations()) {
    if (freezeMs !== null || animation.effect?.getComputedTiming().iterations === Infinity) {
      animation.pause();
      animation.currentTime = freezeMs ?? 0;
    } else animation.finish();
  }
  const nodes = {};
  const visit = (element, path) => {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(element, pseudo);
      if (pseudo && (style.content === "none" || style.content === "normal")) continue;
      const values = {};
      for (let index = 0; index < style.length; index++) {
        const name = style[index];
        values[name] = style.getPropertyValue(name);
      }
      nodes[path + (pseudo ?? "")] = values;
    }
    if (freezeMs !== null && element.localName === "svg") return;
    [...element.children].forEach((child, index) => {
      // The head holds the links of the build's chunks, which change with the chunks, and shows nothing.
      if (child.localName !== "head") visit(child, path + ">" + child.localName + ":" + index);
    });
  };
  visit(document.documentElement, "html");
  return nodes;
})()`;

type LookNodes = Record<string, Record<string, string>>;

// In the page: the enabled stylesheets whose last style rule is the mark of `web-sign-in.css`.
const SIGN_IN_SHEETS_ON = `[...document.styleSheets].filter((sheet) => {
  if (sheet.disabled) return false;
  let rules = [];
  try {
    rules = [...sheet.cssRules].filter((rule) => rule instanceof CSSStyleRule);
  } catch {
    return false;
  }
  return rules.at(-1)?.selectorText === ".openbot-web-sign-in-sheet";
}).length`;

/** The signed-out screens of `/app`: how each one opens, and the account service answers it needs. */
const LOOK_SCREENS: {
  name: string;
  account: (path: string) => AccountAnswer | undefined;
  open: (page: Page) => Promise<void>;
  /** Reads the screen at this time of its animations, with motion on. */
  freezeMs?: number;
  /** Stops `web-client.css`, so the screen shows with the sign-in stylesheet only, as on a slow network. */
  signInStylesOnly?: boolean;
}[] = [
  {
    name: "sign-in",
    account: () => undefined,
    open: async (page) => {
      await page.locator('input[type="email"]').waitFor({ state: "visible" });
    },
  },
  {
    name: "email-error",
    account: () => undefined,
    open: async (page) => {
      await page.locator('input[type="email"]').fill("not-an-email");
      await page.locator('input[type="email"]').blur();
      await page.locator("#account-email-error:not([aria-hidden])").waitFor({ state: "visible" });
    },
  },
  {
    name: "code",
    account: (path) =>
      path === "email/start"
        ? {
            status: 200,
            body: { challengeId: "look", resendAt: 0, expiresAt: Date.now() + 600_000 },
          }
        : undefined,
    open: async (page) => {
      await page.locator('input[type="email"]').fill("look@example.com");
      await page.locator('button[type="submit"]').click();
      await page.locator(".otp-input-native").waitFor({ state: "visible" });
    },
  },
  {
    name: "code-error",
    account: (path) =>
      path === "email/start"
        ? {
            status: 200,
            body: { challengeId: "look", resendAt: 0, expiresAt: Date.now() + 600_000 },
          }
        : path === "email/verify"
          ? { status: 400, body: { error: { code: "invalid_sign_in_code", message: "That code is not right." } } }
          : undefined,
    open: async (page) => {
      await page.locator('input[type="email"]').fill("look@example.com");
      await page.locator('button[type="submit"]').click();
      await page.locator(".otp-input-native").fill("23456789");
      await page.locator('.otp-input[data-status="error"]').waitFor({ state: "visible" });
    },
  },
  {
    name: "consent",
    account: () => undefined,
    freezeMs: 400,
    open: async (page) => {
      // Ticking the analytics box makes three agent avatars pop out of the row.
      const box = page.getByRole("checkbox").first();
      await box.uncheck();
      await box.check();
    },
  },
  {
    name: "code-early",
    account: (path) =>
      path === "email/start"
        ? { status: 200, body: { challengeId: "look", resendAt: 0, expiresAt: Date.now() + 600_000 } }
        : undefined,
    signInStylesOnly: true,
    open: async (page) => {
      await page.locator('input[type="email"]').fill("look@example.com");
      await page.locator('button[type="submit"]').click();
      await page.locator(".otp-input-native").waitFor({ state: "visible" });
    },
  },
  {
    name: "code-error-early",
    account: (path) =>
      path === "email/start"
        ? { status: 200, body: { challengeId: "look", resendAt: 0, expiresAt: Date.now() + 600_000 } }
        : path === "email/verify"
          ? { status: 400, body: { error: { code: "invalid_sign_in_code", message: "That code is not right." } } }
          : undefined,
    signInStylesOnly: true,
    open: async (page) => {
      await page.locator('input[type="email"]').fill("look@example.com");
      await page.locator('button[type="submit"]').click();
      await page.locator(".otp-input-native").fill("23456789");
      await page.locator('.otp-input[data-status="error"]').waitFor({ state: "visible" });
    },
  },
  {
    name: "unavailable",
    account: (path) =>
      path === "session" ? { status: 503, body: { error: { code: "unavailable", message: "Down." } } } : undefined,
    open: async (page) => {
      await page.locator("button.account-login-primary").waitFor({ state: "visible" });
      await page.waitForFunction("!document.querySelector('input[type=\"email\"]')");
    },
  },
];

const LOOK_LAYOUTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
} as const;

/**
 * Saves the computed styles and a screenshot of each signed-out screen, in each layout and theme, to
 * `<out>/look/`. With `--compare-look=<folder>`, it fails on any style that is not the same as there.
 */
async function measureLook(browser: Browser, samples: Samples): Promise<void> {
  const preview = option("url") ? null : await startPreview();
  const upstream = option("url")?.replace(/\/$/, "") ?? preview?.url;
  assert.ok(upstream);
  const lookDir = resolve(OUT, "look");
  mkdirSync(lookDir, { recursive: true });
  const compareDir = option("compare-look");
  // Properties that a change is meant to alter, such as `counter-reset` on the body, which KaTeX's
  // stylesheet sets for its equation numbers when it loads.
  const allowedLook = new Set(option("allow-look")?.split(",") ?? []);
  const differences: { screen: string; node: string; property: string; before: string; after: string }[] = [];
  let current: (path: string) => AccountAnswer | undefined = () => undefined;
  const proxy = await startGzipProxy(upstream, (path) => current(path));
  try {
    for (const [layout, options] of Object.entries(LOOK_LAYOUTS)) {
      for (const theme of ["dark", "light"] as const) {
        for (const screen of LOOK_SCREENS) {
          const name = `${screen.name}-${layout}-${theme}`;
          current = screen.account;
          const context = await browser.newContext({
            ...options,
            reducedMotion: screen.freezeMs === undefined ? "reduce" : "no-preference",
          });
          try {
            await context.addInitScript(`localStorage.setItem("openbot.web.appearance", ${JSON.stringify(theme)})`);
            const page = await context.newPage();
            // Main has no `web-client-*.css`: there, this stops nothing and the full stylesheet shows.
            if (screen.signInStylesOnly) await page.route("**/assets/web-client-*.css", (route) => route.abort());
            await page.goto(`${proxy.url}/app`);
            await screen.open(page).catch(async (error: unknown) => {
              await page.screenshot({ path: resolve(lookDir, `${name}-failed.png`) });
              throw error;
            });
            await page.waitForLoadState("networkidle");
            await page.waitForFunction("!document.querySelector('.app-loading')", undefined, { timeout: 30_000 });
            const nodes = await page.evaluate<LookNodes>(readLook(screen.freezeMs));
            await page.screenshot({ path: resolve(lookDir, `${name}.png`) });
            writeFileSync(resolve(lookDir, `${name}.json`), JSON.stringify(nodes));
            record(samples, `look.${name}.nodes`, Object.keys(nodes).length);
            // The sign-in stylesheet is on until the workspace code and the full stylesheet load.
            record(samples, `look.${name}.signInSheetsOn`, await page.evaluate<number>(SIGN_IN_SHEETS_ON));
            if (!compareDir) continue;
            const before: LookNodes = JSON.parse(readFileSync(resolve(compareDir, `${name}.json`), "utf8"));
            for (const node of new Set([...Object.keys(before), ...Object.keys(nodes)])) {
              if (node.startsWith("html>head")) continue;
              const old = before[node] ?? {};
              const now = nodes[node] ?? {};
              for (const property of new Set([...Object.keys(old), ...Object.keys(now)])) {
                // A custom property shows only where a property reads it, and those are compared.
                if (property.startsWith("--") || allowedLook.has(property)) continue;
                if (old[property] !== now[property])
                  differences.push({
                    screen: name,
                    node,
                    property,
                    before: old[property] ?? "(none)",
                    after: now[property] ?? "(none)",
                  });
              }
            }
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    proxy.server.close();
    preview?.stop();
  }
  if (!compareDir) return;
  writeFileSync(resolve(OUT, "look-differences.json"), `${JSON.stringify(differences, null, 2)}\n`);
  record(samples, "look.differences", differences.length);
  assert.equal(
    differences.length,
    0,
    `${differences.length} computed styles changed; see ${resolve(OUT, "look-differences.json")}.`,
  );
}

// ---------------------------------------------------------------- runtime

const STREAM_TOKENS = 2000;
const OTHER_STREAM_TOKENS = 200;
const STORY = "web-workspace--long-conversation";

async function readCalls(page: Page): Promise<Record<string, number>> {
  const calls = await page.evaluate("({ ...globalThis.openbotWebBench.calls })");
  assert.ok(isDynamicRecord(calls), "The bench call counts are not an object.");
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(calls)) if (isNumber(value)) counts[name] = value;
  return counts;
}

function recordCalls(samples: Samples, prefix: string, calls: Record<string, number>, names: Set<string>): void {
  let total = 0;
  for (const name of names) {
    total += calls[name] ?? 0;
    record(samples, `${prefix}.${name}`, calls[name] ?? 0);
  }
  record(samples, `${prefix}.total`, total);
}

const CALL_NAMES = new Set([
  "connect",
  "listHosts",
  "listAgents",
  "conversation",
  "conversationReads",
  "markRead",
  "queue",
  "status",
  "models",
  "getSidebarLayout",
  "accountUsage",
]);

async function measureRuntime(browser: Browser, samples: Samples): Promise<void> {
  assert.ok(storybook, "The runtime phase needs --storybook=<url> from `bun run storybook`.");
  // The first open of a story makes Vite bundle its dependencies. One open before the runs keeps
  // that out of the first reading.
  const warmUp = await browser.newPage();
  await warmUp.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
  await warmUp.getByText("Question 158:").first().waitFor({ timeout: 300_000 });
  await warmUp.close();
  for (let run = 0; run < runs; run++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
      await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 120_000 });
      await page.evaluate("globalThis.openbotWebBench.ready");
      await page.getByText("Question 158:").first().waitFor({ timeout: 60_000 });
      await page.evaluate("globalThis.openbotWebBench.idle()");
      record(samples, "runtime.openMs", await page.evaluate<number>("performance.now()"));

      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      const marker = `perf-marker-${run}-${Date.now()}`;
      const stop = await startRenderRecording(page, { frames: true, callCounts: false });
      const started = Date.now();
      await page.evaluate(([tokens, text]) => globalThis.openbotWebBench.stream(tokens, text), [
        STREAM_TOKENS,
        marker,
      ] as const);
      await page.getByText(marker).first().waitFor({ timeout: 60_000 });
      record(samples, "runtime.stream.wallMs", Date.now() - started);
      const { values } = await stop();
      for (const [key, value] of Object.entries(values))
        record(samples, `runtime.stream.${key.replace("render.", "")}`, value);
      recordCalls(samples, "runtime.turn.calls", await readCalls(page), CALL_NAMES);

      // A turn of an agent that is not open.
      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      await page.evaluate(([tokens, text]) => globalThis.openbotWebBench.stream(tokens, text, true), [
        OTHER_STREAM_TOKENS,
        `${marker}-other`,
      ] as const);
      recordCalls(samples, "runtime.otherTurn.calls", await readCalls(page), CALL_NAMES);

      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      await page.evaluate("window.dispatchEvent(new Event('focus')); globalThis.openbotWebBench.idle()");
      await page.evaluate("globalThis.openbotWebBench.idle()");
      recordCalls(samples, "runtime.focus.calls", await readCalls(page), CALL_NAMES);
      logger.info(`runtime run ${run + 1}/${runs}: ${samples["runtime.stream.scriptMs"]?.at(-1)} ms script`);
    } finally {
      await page.close();
    }
  }
}

// ---------------------------------------------------------------- style

const STYLE_LAYOUTS = { ipad: "iPad Pro 11 landscape", iphone: "iPhone 15 Pro" } as const;

// In the story: the median time of a custom property change on `.web-app`, until the last element has
// its style again.
const ROOT_RESTYLE = `(() => {
  const app = document.querySelector(".web-app");
  const all = app.querySelectorAll("*");
  const leaf = all[all.length - 1];
  const times = [];
  for (let index = 0; index < 21; index++) {
    const start = performance.now();
    app.style.setProperty("--perf-probe", String(index));
    void getComputedStyle(leaf).color;
    times.push(performance.now() - start);
  }
  app.style.removeProperty("--perf-probe");
  times.sort((a, b) => a - b);
  return times[10];
})()`;

// In the story: iOS does not resize the page for the keyboard, it changes `visualViewport`. A stand-in
// for it reports a keyboard that opens over 20 frames and then pans for 10, to the real module.
const KEYBOARD = `(async () => {
  const viewport = new EventTarget();
  const full = document.documentElement.clientHeight;
  Object.assign(viewport, { height: full, offsetTop: 0, scale: 1, width: innerWidth });
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  const { trackVisualViewport } = await import("/src/renderer/src/features/web-client/web-visual-viewport.ts");
  const stop = trackVisualViewport(document.querySelector(".web-app"));
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  await frame();
  await frame();
  const frames = [];
  const styles = [];
  let last = performance.now();
  for (let step = 1; step <= 30; step++) {
    viewport.height = Math.round(full - full * 0.4 * Math.min(1, step / 20));
    viewport.offsetTop = step > 20 ? (step - 20) * 3 : 0;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    await frame();
    const styleStart = performance.now();
    void document.body.offsetHeight;
    styles.push(performance.now() - styleStart);
    const now = performance.now();
    frames.push(now - last);
    last = now;
  }
  stop();
  frames.sort((a, b) => a - b);
  styles.sort((a, b) => a - b);
  return { styleMs: styles[15], frameMs: frames[15], framesOver20Ms: frames.filter((ms) => ms > 20).length };
})()`;

async function measureStyle(samples: Samples): Promise<void> {
  assert.ok(storybook, "The style phase needs --storybook=<url> from `bun run storybook`.");
  const browser = await webkit.launch();
  try {
    for (const [layout, device] of Object.entries(STYLE_LAYOUTS)) {
      for (let run = 0; run < runs; run++) {
        const context = await browser.newContext({ ...devices[device] });
        try {
          const page = await context.newPage();
          await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
          await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 300_000 });
          await page.evaluate("globalThis.openbotWebBench.ready");
          await page.evaluate("globalThis.openbotWebBench.idle()");
          record(samples, `style.${layout}.rootVarMs`, await page.evaluate<number>(ROOT_RESTYLE));
          const keyboard = await page.evaluate(KEYBOARD);
          assert.ok(isDynamicRecord(keyboard), "The keyboard reading is not an object.");
          for (const [key, value] of Object.entries(keyboard))
            if (isNumber(value)) record(samples, `style.${layout}.keyboard.${key}`, value);
        } finally {
          await context.close();
        }
      }
      logger.info(`style ${layout}: ${samples[`style.${layout}.rootVarMs`]?.join(", ")} ms per root change`);
    }
  } finally {
    await browser.close();
  }
}

declare global {
  // The driver that `src/renderer/src/preview/bench-web-runtime.ts` installs in the story.
  var openbotWebBench: { stream(tokens: number, marker: string, other?: boolean, gapMs?: number): Promise<void> };
}

// ---------------------------------------------------------------- report

function parseReport(path: string): Report {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isDynamicRecord(parsed) && isDynamicRecord(parsed.metrics), `${path} is not a perf:web report.`);
  const metrics: Record<string, Spread> = {};
  for (const [key, value] of Object.entries(parsed.metrics)) {
    if (isDynamicRecord(value) && isNumber(value.median) && isNumber(value.min) && isNumber(value.max))
      metrics[key] = { median: value.median, min: value.min, max: value.max };
  }
  return {
    label: String(parsed.label ?? path),
    createdAt: String(parsed.createdAt ?? ""),
    commit: String(parsed.commit ?? ""),
    runs: isNumber(parsed.runs) ? parsed.runs : 0,
    throttle: String(parsed.throttle ?? ""),
    metrics,
  };
}

function comparison(before: Report, after: Report): string {
  const lines = ["| Metric | Before | After | Change |", "| --- | ---: | ---: | ---: |"];
  for (const key of Object.keys({ ...before.metrics, ...after.metrics }).sort()) {
    const old = before.metrics[key]?.median;
    const now = after.metrics[key]?.median;
    const change =
      old === undefined || now === undefined
        ? "n/a"
        : old === 0
          ? now === 0
            ? "0%"
            : "new"
          : `${now >= old ? "+" : ""}${(((now - old) / old) * 100).toFixed(1)}%`;
    lines.push(`| ${key} | ${old ?? "–"} | ${now ?? "–"} | ${change} |`);
  }
  return lines.join("\n");
}

const samples: Samples = {};
if (phases.has("bundle")) measureBundle(samples);
if (phases.has("load") || phases.has("runtime") || phases.has("look")) {
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    if (phases.has("load")) await measureLoad(browser, samples);
    if (phases.has("runtime")) await measureRuntime(browser, samples);
    if (phases.has("look")) await measureLook(browser, samples);
  } finally {
    await browser.close();
  }
}
if (phases.has("style")) await measureStyle(samples);

const metrics: Record<string, Spread> = {};
for (const [key, values] of Object.entries(samples)) {
  const summary = spread(values);
  if (summary) metrics[key] = summary;
}
const report: Report = {
  label: outName,
  createdAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  runs,
  throttle,
  metrics,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = Object.entries(metrics).map(([key, value]) => `${key}: ${value.median} (${value.min}–${value.max})`);
logger.info(`${resolve(OUT, "report.json")}\n${lines.join("\n")}`);
if (comparePath) {
  assert.ok(statSync(comparePath).isFile(), `--compare: ${comparePath} is not a file.`);
  const table = comparison(parseReport(comparePath), report);
  writeFileSync(resolve(OUT, "comparison.md"), `${table}\n`);
  logger.info(`\n${table}`);
}
