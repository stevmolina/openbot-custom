// Compares the web client's stylesheets of two builds of the account service and writes
// .openbot-build/<out>/report.json. The "before" build is a copy of `apps/auth-api/dist/client` from the
// base commit; the "after" build is the last `bun run api:build`.
//
// - size: CSS bytes (raw and gzip) and style rules at sign-in and in the workspace, from each Vite
//   manifest. `everyElementSelectors` counts the selectors that match every element or its `::before`
//   or `::after`. `desktopOnly` lists the `styles.css` imports that the web stylesheet leaves out.
// - style: the `Web/Workspace/LongConversation` story of a running Storybook in WebKit, with the iPad
//   and iPhone layouts of Safari. The story's development styles are turned off, and the production
//   stylesheets of one build go in their place, so both builds style the same page. `rootVarMs` is the
//   style time of one custom property change on `.web-app`; `keyboardToggleMs` is the style time of
//   `data-web-keyboard-open` on it, which changes when the keyboard opens or closes. `keyboard.*` plays a keyboard that opens over
//   20 frames and pans for 10, as iOS reports it through `visualViewport`, into the real
//   `web-visual-viewport.ts`. Storybook runs development code, so compare these times only with each
//   other.
// - look: the main screens (chat list, an open chat with Markdown, code and tool cards, tasks, settings,
//   marketplace, routines, usage and the server menu from the story, and the signed-out sign-in screen
//   from `vite preview` of the after build) in the iPhone and iPad layouts, dark and light. Each screen
//   is captured with the before stylesheets, again with the before stylesheets (the noise of the
//   screen), and with the after stylesheets. The report counts the pixels that differ. A screen whose
//   after capture differs by more than its noise fails the run. The captures go to `<out>/look/`.
// - video: a recording of the story at iPhone size with the after stylesheets while a keyboard opens,
//   as `<out>/video/keyboard.webm`.
//
// `bun scripts/web-css-weight-e2e.ts --before=<dist/client of the base build> --storybook=<url>
//  [--after=apps/auth-api/dist/client] [--runs=21] [--out=web-css-weight] [--phases=size,style,look,video]
//  [--screen=chat-markdown-code]`
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, type BrowserContext, devices, type Page, webkit } from "playwright-core";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { DESKTOP_ONLY_STYLES } from "./web-stylesheet";

const logger = createOpenBotLogger("web-css-weight-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const beforeDir = option("before");
assert.ok(beforeDir, "--before takes the dist/client folder of the base build.");
const builds = { before: resolve(beforeDir), after: resolve(option("after") ?? resolve(API_DIR, "dist/client")) };
for (const dir of Object.values(builds))
  assert.ok(existsSync(join(dir, ".vite/manifest.json")), `${dir} has no manifest.`);
const runs = Number(option("runs") ?? "21");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const outName = option("out") ?? "web-css-weight";
assert.match(outName, /^\w[\w.-]*$/, "--out takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", outName);
const phases = new Set((option("phases") ?? "size,style,look,video").split(","));
const storybook = option("storybook")?.replace(/\/$/, "");
if (phases.has("style") || phases.has("look") || phases.has("video"))
  assert.ok(storybook, "The style, look and video phases need --storybook=<url> from `bun run storybook`.");

type BuildName = keyof typeof builds;

// ---------------------------------------------------------------- stylesheets of a build

interface ManifestChunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

const APP_ROUTE_KEY = "src/routes/app.lazy.tsx";
const WEB_CLIENT_CSS_KEY = "../../src/renderer/src/features/web-client/web-client.css";
// The stylesheets that load with a screen: the routine canvas, the diagram board and KaTeX.
const SCREEN_CSS = /^assets\/(WorkflowsCanvas|diagrams|katex)-[\w-]+\.css$/;

interface BuildStyles {
  /** The stylesheets of every page, in order. */
  entry: string[];
  /** The sign-in stylesheet of `/app`, which turns off when the web client's stylesheet has loaded. */
  signIn: string[];
  webClient: string;
  screens: string[];
}

function readManifest(dir: string): Record<string, ManifestChunk> {
  const parsed = JSON.parse(readFileSync(join(dir, ".vite/manifest.json"), "utf8"));
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

function cssClosure(manifest: Record<string, ManifestChunk>, key: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const chunk = manifest[current];
    if (!chunk) return;
    for (const imported of chunk.imports ?? []) visit(imported);
    for (const css of chunk.css ?? []) if (!files.includes(css)) files.push(css);
  };
  visit(key);
  return files;
}

function buildStyles(dir: string): BuildStyles {
  const manifest = readManifest(dir);
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  assert.ok(entryKey, `${dir}: the manifest has no entry.`);
  const entry = cssClosure(manifest, entryKey);
  const signIn = cssClosure(manifest, APP_ROUTE_KEY).filter((file) => !entry.includes(file));
  const webClient = manifest[WEB_CLIENT_CSS_KEY]?.file;
  assert.ok(webClient, `${dir}: the manifest has no web client stylesheet.`);
  const screens = [...new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]))].filter(
    (file) => SCREEN_CSS.test(file),
  );
  return { entry, signIn, webClient, screens };
}

const styles = { before: buildStyles(builds.before), after: buildStyles(builds.after) };
const cssText = (build: BuildName, files: readonly string[]) =>
  files.map((file) => readFileSync(join(builds[build], file), "utf8"));

// ---------------------------------------------------------------- size

/** Style rules, and selectors that match every element or its `::before` or `::after`. */
function countRules(css: string): { rules: number; everyElementSelectors: number } {
  let rules = 0;
  let everyElementSelectors = 0;
  let prelude = "";
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
      const styleRule = !head.startsWith("@") && blocks.at(-1) !== true;
      if (styleRule) {
        rules++;
        for (const selector of head.split(","))
          if (/^(\*|\*?::?(before|after))$/.test(selector.trim())) everyElementSelectors++;
      }
      blocks.push(styleRule || /^@(-\w+-)?keyframes/.test(head));
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
  return { rules, everyElementSelectors };
}

interface SizeTotals {
  files: string[];
  rawKB: number;
  gzipKB: number;
  rules: number;
  everyElementSelectors: number;
}

function sizeOf(build: BuildName, files: readonly string[], retired: readonly string[] = []): SizeTotals {
  let raw = 0;
  let gzip = 0;
  let rules = 0;
  let everyElementSelectors = 0;
  for (const file of files) {
    const content = readFileSync(join(builds[build], file));
    raw += content.byteLength;
    gzip += gzipSync(content, { level: 9 }).byteLength;
    if (retired.includes(file)) continue;
    const counted = countRules(content.toString("utf8"));
    rules += counted.rules;
    everyElementSelectors += counted.everyElementSelectors;
  }
  const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
  return { files: [...files], rawKB: kb(raw), gzipKB: kb(gzip), rules, everyElementSelectors };
}

interface BuildSize {
  signIn: SizeTotals;
  /** With the sign-in stylesheet downloaded but off, once the web client's stylesheet has loaded. */
  workspace: SizeTotals;
  webClient: SizeTotals;
}

interface SizeReport {
  before: BuildSize;
  after: BuildSize;
  desktopOnly: { file: string; sourceKB: number; rules: number }[];
}

function buildSize(build: BuildName): BuildSize {
  const { entry, signIn, webClient } = styles[build];
  return {
    signIn: sizeOf(build, [...entry, ...signIn]),
    workspace: sizeOf(build, [...entry, ...signIn, webClient], signIn),
    webClient: sizeOf(build, [webClient]),
  };
}

function measureSize(): SizeReport {
  const rendererSource = resolve(ROOT, "src/renderer/src");
  const desktopOnly = DESKTOP_ONLY_STYLES.map((file) => {
    const source = readFileSync(resolve(rendererSource, file), "utf8");
    return { file, sourceKB: Math.round((source.length / 1024) * 10) / 10, rules: (source.match(/\{/g) ?? []).length };
  });
  return { before: buildSize("before"), after: buildSize("after"), desktopOnly };
}

// ---------------------------------------------------------------- a page with production stylesheets

/** Serves `/assets/*` (fonts and images that the production stylesheets name) from the two builds. */
async function serveAssets(context: BrowserContext): Promise<void> {
  await context.route("**/assets/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    for (const dir of Object.values(builds)) {
      const path = join(dir, "assets", name);
      if (existsSync(path)) return route.fulfill({ path });
    }
    return route.fallback();
  });
}

// In the page: turns off the stylesheets of the app's code (Vite's development styles in Storybook, the
// linked stylesheets of a build), also the ones that load later, and puts the given stylesheet texts in
// their place. Styles that a library adds at run time, such as the toasts', stay on.
const USE_STYLES = `(texts) => {
  const own = (node) =>
    (node instanceof HTMLStyleElement && "viteDevId" in node.dataset) ||
    (node instanceof HTMLLinkElement && node.rel === "stylesheet");
  const turnOff = (node) => {
    if (!own(node)) return;
    node.disabled = true;
    if (node instanceof HTMLLinkElement) node.media = "not all";
  };
  for (const node of document.querySelectorAll("style, link[rel=stylesheet]")) turnOff(node);
  if (!globalThis.__weightObserver) {
    globalThis.__weightObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) turnOff(node);
    });
    globalThis.__weightObserver.observe(document.head, { childList: true });
  }
  for (const node of document.querySelectorAll("style[data-weight-probe]")) node.remove();
  for (const text of texts) {
    const style = document.createElement("style");
    style.dataset.weightProbe = "";
    style.textContent = text;
    document.head.append(style);
  }
  // A forced layout, not a frame: a capture stops the page's clock, and with it the frames.
  return document.fonts.ready.then(() => { void document.documentElement.offsetHeight; });
}`;

async function useStyles(page: Page, texts: readonly string[]): Promise<void> {
  await page.evaluate(`(${USE_STYLES})(${JSON.stringify(texts)})`);
}

const STORY_LAYOUTS = { iphone: "iPhone 15 Pro", ipad: "iPad Pro 11 landscape" } as const;
type Layout = keyof typeof STORY_LAYOUTS;
const LAYOUTS: readonly Layout[] = ["iphone", "ipad"];

async function openStory(
  browser: Browser,
  layout: Layout,
  story: string,
  scheme: "dark" | "light",
  options: { video?: string; clock?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const device = devices[STORY_LAYOUTS[layout]];
  const context = await browser.newContext({
    ...device,
    ...(options.video ? { recordVideo: { dir: options.video, size: device.viewport } } : {}),
  });
  // A controlled clock runs at the real pace until a capture stops it.
  if (options.clock) await context.clock.install();
  await serveAssets(context);
  const page = await context.newPage();
  await page.goto(`${storybook}/iframe.html?id=${story}&viewMode=story&globals=colorScheme:${scheme}`);
  await page.waitForSelector(".web-app", { timeout: 300_000 });
  return { context, page };
}

// ---------------------------------------------------------------- style

const STORY = "web-workspace--long-conversation";

// In the story: the median time of the keyboard's attribute change on `.web-app` (the stylesheet
// selects it, so the whole app is styled again), until the last element has its style again.
const KEYBOARD_TOGGLE = `(() => {
  const app = document.querySelector(".web-app");
  const all = app.querySelectorAll("*");
  const leaf = all[all.length - 1];
  const times = [];
  for (let index = 0; index < 21; index++) {
    const start = performance.now();
    app.toggleAttribute("data-web-keyboard-open");
    void getComputedStyle(leaf).color;
    times.push(performance.now() - start);
  }
  app.removeAttribute("data-web-keyboard-open");
  times.sort((a, b) => a - b);
  return times[10];
})()`;

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

async function waitForStory(page: Page): Promise<void> {
  await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 300_000 });
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.evaluate("globalThis.openbotWebBench.idle()");
}

type Samples = Record<string, number[]>;

function record(samples: Samples, key: string, value: number): void {
  const values = samples[key] ?? [];
  values.push(Math.round(value * 10) / 10);
  samples[key] = values;
}

async function measureStyle(browser: Browser): Promise<Record<string, Spread>> {
  const samples: Samples = {};
  const texts = {
    before: cssText("before", [...styles.before.entry, styles.before.webClient]),
    after: cssText("after", [...styles.after.entry, styles.after.webClient]),
  };
  for (const layout of LAYOUTS) {
    const { context, page } = await openStory(browser, layout, STORY, "dark");
    try {
      await waitForStory(page);
      // The phone layout opens on the chat list: open the long conversation, as the iPad layout shows it.
      await page
        .getByRole("button", { name: /^Chief\. / })
        .first()
        .click();
      await page.evaluate("globalThis.openbotWebBench.idle()");
      record(
        samples,
        `${layout}.elements`,
        await page.evaluate<number>(`document.querySelectorAll(".web-app *").length`),
      );
      for (let run = 0; run < runs; run++) {
        // Alternate the order, so a slower first or second turn does not favor one build.
        const order: BuildName[] = run % 2 === 0 ? ["before", "after"] : ["after", "before"];
        for (const build of order) {
          await useStyles(page, texts[build]);
          record(samples, `${layout}.${build}.rootVarMs`, await page.evaluate<number>(ROOT_RESTYLE));
          record(samples, `${layout}.${build}.keyboardToggleMs`, await page.evaluate<number>(KEYBOARD_TOGGLE));
          const keyboard = await page.evaluate(KEYBOARD);
          assert.ok(isDynamicRecord(keyboard), "The keyboard reading is not an object.");
          for (const [key, value] of Object.entries(keyboard))
            if (isNumber(value)) record(samples, `${layout}.${build}.keyboard.${key}`, value);
        }
      }
    } finally {
      await context.close();
    }
    logger.info(
      `style ${layout}: root change ${samples[`${layout}.before.rootVarMs`]?.join(", ")} ms before, ${samples[`${layout}.after.rootVarMs`]?.join(", ")} ms after`,
    );
  }
  const metrics: Record<string, Spread> = {};
  for (const [key, values] of Object.entries(samples)) {
    const summary = spread(values);
    if (summary) metrics[key] = summary;
  }
  return metrics;
}

// ---------------------------------------------------------------- look

interface Screen {
  name: string;
  story: string;
  /** What the screen needs before the capture: buttons and menu items to press, in order. */
  steps: { role: "button" | "menuitem"; name: RegExp }[];
}

const MORE = { role: "button", name: /^More$/ } as const;
const SCREENS: readonly Screen[] = [
  { name: "chat-list", story: "web-workspace--connected", steps: [] },
  {
    name: "chat-tool-cards",
    story: "web-workspace--connected",
    steps: [{ role: "button", name: /^Chief\. / }],
  },
  {
    name: "chat-markdown-code",
    story: "web-workspace--long-conversation",
    steps: [{ role: "button", name: /^Chief\. / }],
  },
  {
    name: "tasks",
    story: "web-workspace--connected",
    steps: [
      { role: "button", name: /^Chief\. / },
      { role: "button", name: /^Tasks / },
    ],
  },
  { name: "settings", story: "web-workspace--connected", steps: [MORE, { role: "menuitem", name: /^Settings$/ }] },
  {
    name: "marketplace",
    story: "web-workspace--connected",
    steps: [MORE, { role: "menuitem", name: /^Marketplace$/ }],
  },
  { name: "routines", story: "web-workspace--connected", steps: [MORE, { role: "menuitem", name: /^Routines$/ }] },
  { name: "usage", story: "web-workspace--connected", steps: [MORE, { role: "menuitem", name: /^Usage$/ }] },
  { name: "server-menu", story: "web-workspace--connected", steps: [{ role: "button", name: /Preview computer/ }] },
];

// In a blank page: the pixels that differ between two PNG captures, and an image that marks them.
const PIXEL_DIFF = `async ([first, second]) => {
  const load = async (base64) => createImageBitmap(await (await fetch("data:image/png;base64," + base64)).blob());
  const [a, b] = await Promise.all([load(first), load(second)]);
  if (a.width !== b.width || a.height !== b.height) return { pixels: -1, image: "" };
  const read = (bitmap) => {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const da = read(a);
  const db = read(b);
  const marks = new ImageData(a.width, a.height);
  let pixels = 0;
  for (let index = 0; index < da.data.length; index += 4) {
    const same = da.data[index] === db.data[index] && da.data[index + 1] === db.data[index + 1] &&
      da.data[index + 2] === db.data[index + 2] && da.data[index + 3] === db.data[index + 3];
    marks.data[index] = same ? da.data[index] / 3 : 255;
    marks.data[index + 1] = same ? da.data[index + 1] / 3 : 0;
    marks.data[index + 2] = same ? da.data[index + 2] / 3 : 0;
    marks.data[index + 3] = 255;
    if (!same) pixels++;
  }
  if (pixels === 0) return { pixels, image: "" };
  const canvas = new OffscreenCanvas(a.width, a.height);
  canvas.getContext("2d").putImageData(marks, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { pixels, image: btoa(binary) };
}`;

interface LookResult {
  screen: string;
  layout: Layout;
  scheme: "dark" | "light";
  /** Pixels that differ between two captures with the before stylesheets: the noise of the screen. */
  noisePixels: number;
  /** Pixels that differ between the before and the after stylesheets. */
  diffPixels: number;
  ok: boolean;
}

async function pixelDiff(diffPage: Page, first: Buffer, second: Buffer, diffPath?: string): Promise<number> {
  const result = await diffPage.evaluate(
    `(${PIXEL_DIFF})(${JSON.stringify([first.toString("base64"), second.toString("base64")])})`,
  );
  assert.ok(isDynamicRecord(result) && isNumber(result.pixels), "The pixel diff is not a reading.");
  if (diffPath && typeof result.image === "string" && result.image !== "")
    writeFileSync(diffPath, Buffer.from(result.image, "base64"));
  return result.pixels;
}

async function capture(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: "disabled", caret: "hide" });
}

async function compareCaptures(
  diffPage: Page,
  page: Page,
  name: string,
  texts: Record<BuildName, string[]>,
): Promise<{ noisePixels: number; diffPixels: number }> {
  const dir = resolve(OUT, "look");
  // The screen has loaded; its clock stops, so timers, counters and drawn motion stay still.
  await page.clock.pauseAt(Date.now() + 1_000);
  await useStyles(page, texts.before);
  let before = await capture(page);
  // Two captures in a row that match: the screen has settled. What still differs is its noise.
  let noisePixels = -1;
  for (let attempt = 0; attempt < 6 && noisePixels !== 0; attempt++) {
    await page.waitForTimeout(400);
    const again = await capture(page);
    noisePixels = await pixelDiff(diffPage, before, again);
    before = again;
  }
  await useStyles(page, texts.after);
  const after = await capture(page);
  writeFileSync(resolve(dir, `${name}.before.png`), before);
  writeFileSync(resolve(dir, `${name}.after.png`), after);
  const diffPixels = await pixelDiff(diffPage, before, after, resolve(dir, `${name}.diff.png`));
  return { noisePixels, diffPixels };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

/** Starts `vite preview` of the after build, without secrets. Stops only the process group it started. */
async function startPreview(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    "bunx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: API_DIR, detached: true, stdio: "ignore" },
  );
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
  const deadline = Date.now() + 90_000;
  for (;;) {
    const ok = await fetch(`${url}/app`, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return { url, stop };
    if (child.exitCode !== null || Date.now() > deadline) {
      stop();
      throw new Error(`vite preview did not answer at ${url}/app.`);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

const SIGNED_OUT = JSON.stringify({ error: { code: "sign_in_required", message: "Sign in is required." } });

async function measureLook(browser: Browser): Promise<LookResult[]> {
  mkdirSync(resolve(OUT, "look"), { recursive: true });
  const results: LookResult[] = [];
  const diffContext = await browser.newContext();
  const diffPage = await diffContext.newPage();
  const workspace = {
    before: cssText("before", [...styles.before.entry, styles.before.webClient, ...styles.before.screens]),
    after: cssText("after", [...styles.after.entry, styles.after.webClient, ...styles.after.screens]),
  };
  const signIn = {
    before: cssText("before", [...styles.before.entry, ...styles.before.signIn]),
    after: cssText("after", [...styles.after.entry, ...styles.after.signIn]),
  };
  const preview = await startPreview();
  try {
    for (const layout of LAYOUTS) {
      for (const scheme of ["dark", "light"] as const) {
        for (const screen of SCREENS.filter((item) => !option("screen") || item.name === option("screen"))) {
          const { context, page } = await openStory(browser, layout, screen.story, scheme, { clock: true });
          try {
            await page.waitForLoadState("networkidle");
            for (const step of screen.steps) {
              await page.getByRole(step.role, { name: step.name }).first().click();
              await page.waitForLoadState("networkidle");
              await page.waitForTimeout(1_500);
            }
            const name = `${screen.name}.${layout}.${scheme}`;
            const counts = await compareCaptures(diffPage, page, name, workspace);
            results.push({
              screen: screen.name,
              layout,
              scheme,
              ...counts,
              ok: counts.diffPixels <= counts.noisePixels,
            });
            logger.info(`look ${name}: ${counts.diffPixels} pixels differ (noise ${counts.noisePixels})`);
          } finally {
            await context.close();
          }
        }
        // The signed-out sign-in screen of the after build, with the stylesheets of each build.
        const context = await browser.newContext({
          ...devices[STORY_LAYOUTS[layout]],
          colorScheme: scheme,
        });
        try {
          await context.clock.install();
          await serveAssets(context);
          await context.route("**/api/browser/session", (route) =>
            route.fulfill({ status: 401, contentType: "application/json", body: SIGNED_OUT }),
          );
          const page = await context.newPage();
          await page.addInitScript(
            `try { localStorage.setItem("openbot.web.appearance",${JSON.stringify(scheme)}) } catch {}`,
          );
          await page.goto(`${preview.url}/app`);
          await page.waitForSelector("input[type=email]", { timeout: 60_000 });
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(800);
          const name = `sign-in.${layout}.${scheme}`;
          const counts = await compareCaptures(diffPage, page, name, signIn);
          results.push({ screen: "sign-in", layout, scheme, ...counts, ok: counts.diffPixels <= counts.noisePixels });
          logger.info(`look ${name}: ${counts.diffPixels} pixels differ (noise ${counts.noisePixels})`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    preview.stop();
    await diffContext.close();
  }
  return results;
}

// ---------------------------------------------------------------- video

async function recordVideo(browser: Browser): Promise<string> {
  const dir = resolve(OUT, "video");
  mkdirSync(dir, { recursive: true });
  const { context, page } = await openStory(browser, "iphone", STORY, "dark", { video: dir });
  const video = page.video();
  try {
    await waitForStory(page);
    await useStyles(page, cssText("after", [...styles.after.entry, styles.after.webClient]));
    await page
      .getByRole("button", { name: /^Chief\. / })
      .first()
      .click();
    await page.waitForTimeout(1_500);
    await page.getByRole("textbox").first().click();
    await page.waitForTimeout(600);
    for (let turn = 0; turn < 2; turn++) {
      await page.evaluate(KEYBOARD);
      await page.waitForTimeout(1_200);
      await page.evaluate(`document.querySelector(".web-app").style.removeProperty("--web-visual-height")`);
      await page.waitForTimeout(800);
    }
    await page.keyboard.type("Ship the lighter stylesheet", { delay: 40 });
    await page.waitForTimeout(1_500);
  } finally {
    await context.close();
  }
  assert.ok(video, "The context did not record a video.");
  const path = resolve(dir, "keyboard.webm");
  renameSync(await video.path(), path);
  for (const file of readdirSync(dir)) if (file !== "keyboard.webm") logger.info(`video: extra file ${file}`);
  return path;
}

// ---------------------------------------------------------------- report

mkdirSync(OUT, { recursive: true });
interface Report {
  label: string;
  createdAt: string;
  commit: string;
  builds: typeof builds;
  runs: number;
  size?: SizeReport;
  style?: Record<string, Spread>;
  look?: LookResult[];
  video?: string;
}

const report: Report = {
  label: outName,
  createdAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  builds,
  runs,
};
if (phases.has("size")) report.size = measureSize();
let failed = false;
if (phases.has("style") || phases.has("look") || phases.has("video")) {
  const browser = await webkit.launch();
  try {
    if (phases.has("style")) report.style = await measureStyle(browser);
    if (phases.has("look")) {
      const look = await measureLook(browser);
      report.look = look;
      failed = look.some((result) => !result.ok);
    }
    if (phases.has("video")) report.video = await recordVideo(browser);
  } finally {
    await browser.close();
  }
}
const reportPath = resolve(OUT, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
logger.info(`Report: ${reportPath}`);
if (failed) {
  logger.error("The after stylesheets change pixels on a screen. See look/*.diff.png.");
  process.exitCode = 1;
}
