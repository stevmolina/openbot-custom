// Measures how much work a streamed reply makes in the web client, in WebKit with the iPhone and
// iPad layouts. Writes .openbot-build/web-streaming-frames/<label>.json, and a comparison when the
// `before` and `after` reports both exist.
//
// Each case streams one reply of 300 chunks and counts the DOM changes in the chat and in the sidebar,
// the frames, the longest frame, and the time that the 300 chunks took. A `burst` reply sends the
// chunks one task apart, so its time is the work per chunk; a `paced` reply sends one chunk each
// 5 ms, as a fast model does, so its frames show what the reader sees. The cases are the phone with the chat hidden under its chat list,
// the phone with the chat open, and the iPad, which shows the chat beside the list. Storybook is a dev
// build, so compare a `before` run only with an `after` run on the same computer.
//
// It drives the `Web/Workspace/LongConversation` story of a running Storybook:
// `bun scripts/web-streaming-frames-bench.ts --storybook=<url from bun run storybook> --label=after`
// `--runs=<n>` sets the runs per case (the report keeps the median), and `--video` records the open
// phone chat to `<label>-phone-chat.webm`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, devices, type Page, webkit } from "playwright-core";

const logger = createOpenBotLogger("web-streaming-frames-bench");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", "web-streaming-frames");
const STORY = "web-workspace--long-conversation";
const STREAM_TOKENS = 300;
const PACE_NAMES = ["burst", "paced"] as const;
type Pace = (typeof PACE_NAMES)[number];
/** The milliseconds between two chunks. */
const PACES: Record<Pace, number> = { burst: 0, paced: 5 };

const argument = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? undefined;
const storybook = argument("storybook")?.replace(/\/$/, "");
assert.ok(storybook, "Pass --storybook=<url> from `bun run storybook`.");
const label = argument("label") ?? "after";
assert.match(label, /^[a-z0-9-]+$/, "The label is lower case letters, digits and hyphens.");
const runs = Number(argument("runs") ?? 3);
assert.ok(Number.isInteger(runs) && runs > 0, "--runs is a positive integer.");
const video = process.argv.includes("--video");

interface StreamReading {
  chatVisible: boolean;
  chatMutations: number;
  sidebarMutations: number;
  frames: number;
  longestFrameMs: number;
  jankMs: number;
  streamMs: number;
}

type CaseName = "phone-hidden-chat" | "phone-open-chat" | "ipad-chat";

interface CaseReport {
  device: string;
  pace: Pace;
  runs: StreamReading[];
  median: StreamReading;
}

/** Streams one reply while it counts the DOM changes in the chat and in the sidebar, and the frame gaps. */
function streamAndCount(page: Page, marker: string, gapMs: number): Promise<StreamReading> {
  return page.evaluate(
    async ([tokens, text, gap]) => {
      const chat = document.querySelector(".conversation-scroll");
      const sidebar = document.querySelector(".sidebar");
      if (!chat) throw new Error("The story has no chat.");
      let chatMutations = 0;
      let sidebarMutations = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (chat.contains(record.target)) chatMutations += 1;
          else if (sidebar?.contains(record.target)) sidebarMutations += 1;
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      const gaps: number[] = [];
      let last = performance.now();
      let watching = true;
      const frame = (time: number) => {
        gaps.push(time - last);
        last = time;
        if (watching) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const started = performance.now();
      await globalThis.openbotWebBench.stream(tokens, text, false, gap);
      const streamMs = Math.round(performance.now() - started);
      watching = false;
      // The records of the last task arrive in the next microtask checkpoint.
      await new Promise((done) => setTimeout(done, 0));
      observer.disconnect();
      return {
        chatVisible: chat.getClientRects().length > 0,
        chatMutations,
        sidebarMutations,
        frames: gaps.length,
        longestFrameMs: Math.round(Math.max(0, ...gaps)),
        jankMs: Math.round(
          gaps.filter((frameGap) => frameGap > 33).reduce((total, frameGap) => total + frameGap - 16.7, 0),
        ),
        streamMs,
      };
    },
    [STREAM_TOKENS, marker, gapMs] as const,
  );
}

/** Waits until 60 frames in a row are short, so start-up work is not counted as the reply's. */
function steadyFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const deadline = performance.now() + 30_000;
        let last = performance.now();
        let steady = 0;
        const frame = (time: number) => {
          steady = time - last < 50 ? steady + 1 : 0;
          last = time;
          if (steady >= 60) done();
          else if (time > deadline) fail(new Error("The frames did not settle."));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

async function openStory(browser: Browser, device: string, record: boolean): Promise<Page> {
  const descriptor = devices[device];
  assert.ok(descriptor, `Playwright has no device named ${device}.`);
  const context = await browser.newContext({
    ...descriptor,
    ...(record && { recordVideo: { dir: OUT, size: descriptor.viewport } }),
  });
  const page = await context.newPage();
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
  await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 300_000 });
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.locator(".conversation-scroll").waitFor({ state: "attached", timeout: 60_000 });
  await page.evaluate("globalThis.openbotWebBench.idle()");
  await steadyFrames(page);
  return page;
}

async function openChat(page: Page): Promise<void> {
  const { open } = await page.evaluate<{ open: string }>("globalThis.openbotWebBench.agentNames");
  await page.locator(".sidebar-chat-list").getByText(open, { exact: true }).first().click();
  await page.locator(".conversation-scroll").waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate("globalThis.openbotWebBench.idle()");
  await steadyFrames(page);
}

async function measure(
  browser: Browser,
  name: CaseName,
  pace: Pace,
  run: number,
  record: boolean,
): Promise<StreamReading> {
  const device = name === "ipad-chat" ? "iPad Pro 11 landscape" : "iPhone 15 Pro";
  const page = await openStory(browser, device, record);
  try {
    if (name === "phone-open-chat") await openChat(page);
    const marker = `stream-marker-${name}-${pace}-${run}-${Date.now()}`;
    const reading = await streamAndCount(page, marker, PACES[pace]);
    assert.equal(reading.chatVisible, name !== "phone-hidden-chat", `${name}: the chat shows as expected.`);
    if (reading.chatVisible) {
      // The reply reaches the screen: the reveal of the last words ends after the turn does.
      await page.locator(".conversation-scroll").getByText(marker).first().waitFor({ timeout: 30_000 });
      await page.evaluate("globalThis.openbotWebBench.idle()");
    }
    await page.screenshot({ path: resolve(OUT, `${label}-${name}-${pace}.png`) });
    return reading;
  } finally {
    const recording = page.video();
    await page.context().close();
    if (recording) renameSync(await recording.path(), resolve(OUT, `${label}-phone-chat.webm`));
  }
}

function median(readings: StreamReading[]): StreamReading {
  const middle = (key: Exclude<keyof StreamReading, "chatVisible">) => {
    const sorted = readings.map((reading) => reading[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return {
    chatVisible: readings[0]?.chatVisible ?? false,
    chatMutations: middle("chatMutations"),
    sidebarMutations: middle("sidebarMutations"),
    frames: middle("frames"),
    longestFrameMs: middle("longestFrameMs"),
    jankMs: middle("jankMs"),
    streamMs: middle("streamMs"),
  };
}

declare global {
  // The driver that `src/renderer/src/preview/bench-web-runtime.ts` installs in the story.
  var openbotWebBench: { stream(tokens: number, marker: string, other?: boolean, gapMs?: number): Promise<void> };
}

mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const cases: Record<string, CaseReport> = {};
try {
  for (const name of ["phone-hidden-chat", "phone-open-chat", "ipad-chat"] as const)
    for (const pace of PACE_NAMES) {
      const readings: StreamReading[] = [];
      for (let run = 0; run < runs; run++) {
        const record = video && name === "phone-open-chat" && pace === "paced" && run === 0;
        readings.push(await measure(browser, name, pace, run, record));
      }
      cases[`${name}-${pace}`] = {
        device: name === "ipad-chat" ? "iPad Pro 11 landscape" : "iPhone 15 Pro",
        pace,
        runs: readings,
        median: median(readings),
      };
    }
} finally {
  await browser.close();
}
const report = { label, createdAt: new Date().toISOString(), storybook, streamTokens: STREAM_TOKENS, cases };
writeFileSync(resolve(OUT, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`${resolve(OUT, `${label}.json`)}`);

const beforePath = resolve(OUT, "before.json");
const afterPath = resolve(OUT, "after.json");
if (existsSync(beforePath) && existsSync(afterPath)) {
  const before: typeof report = JSON.parse(readFileSync(beforePath, "utf8"));
  const after: typeof report = JSON.parse(readFileSync(afterPath, "utf8"));
  const comparison = Object.fromEntries(
    Object.keys(after.cases).map((name) => {
      const was = before.cases[name]?.median;
      const now = after.cases[name]?.median;
      return [name, { before: was, after: now }];
    }),
  );
  writeFileSync(resolve(OUT, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
  logger.info(`${resolve(OUT, "comparison.json")}\n${JSON.stringify(comparison, null, 2)}`);
}
