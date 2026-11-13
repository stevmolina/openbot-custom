// Checks that a chat nobody sees does no work while a reply streams into it, in WebKit with the
// iPhone and iPad layouts. Writes .openbot-build/web-client-hidden-chat/report.json and screenshots.
//
// A phone shows the chat list and keeps the chat mounted under it, so the Back swipe and the reader's
// place stay. That hidden chat must not draw each chunk of a reply, and must not ask the host for its
// older pages. It catches up when it opens. On the iPad the chat shows, so it draws the reply.
//
// It drives the `Web/Workspace/LongConversation` story of a running Storybook:
// `bun scripts/web-client-hidden-chat-e2e.ts --storybook=<url from bun run storybook>`
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, devices, type Page, webkit } from "playwright-core";

const logger = createOpenBotLogger("web-client-hidden-chat-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", "web-client-hidden-chat");
const STORY = "web-workspace--long-conversation";
const STREAM_TOKENS = 300;
/** The hidden chat can get an attribute or two at the start and the end of a turn, never one per chunk. */
const HIDDEN_CHAT_MUTATION_LIMIT = 10;

const storybook = process.argv
  .find((arg) => arg.startsWith("--storybook="))
  ?.slice("--storybook=".length)
  .replace(/\/$/, "");
assert.ok(storybook, "Pass --storybook=<url> from `bun run storybook`.");

interface StreamReading {
  chatVisible: boolean;
  chatMutations: number;
  sidebarMutations: number;
  rowsBefore: number;
  rowsAfter: number;
  domNodes: number;
  worstFrameMs: number;
  jankMs: number;
}

interface LayoutReport {
  device: string;
  stream: StreamReading;
  olderPageRequests: number;
  markerShownAfterOpen?: boolean;
}

/** Streams one reply while it counts the DOM changes in the chat and in the sidebar, and the frame gaps. */
function streamAndCount(page: Page, marker: string): Promise<StreamReading> {
  return page.evaluate(
    async ([tokens, text]) => {
      const chat = document.querySelector(".conversation-scroll");
      const sidebar = document.querySelector(".sidebar");
      if (!chat) throw new Error("The story has no chat.");
      const rows = () => chat.querySelectorAll("[data-index]").length;
      const rowsBefore = rows();
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
      await globalThis.openbotWebBench.stream(tokens, text);
      watching = false;
      // The records of the last task arrive in the next microtask checkpoint.
      await new Promise((done) => setTimeout(done, 0));
      observer.disconnect();
      return {
        chatVisible: chat.getClientRects().length > 0,
        chatMutations,
        sidebarMutations,
        rowsBefore,
        rowsAfter: rows(),
        domNodes: document.querySelectorAll("*").length,
        worstFrameMs: Math.round(Math.max(0, ...gaps)),
        jankMs: Math.round(gaps.filter((gap) => gap > 33).reduce((total, gap) => total + gap - 16.7, 0)),
      };
    },
    [STREAM_TOKENS, marker] as const,
  );
}

async function openStory(browser: Browser, device: string): Promise<Page> {
  const descriptor = devices[device];
  assert.ok(descriptor, `Playwright has no device named ${device}.`);
  const context = await browser.newContext({ ...descriptor });
  const page = await context.newPage();
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
  await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 300_000 });
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.locator(".conversation-scroll").waitFor({ state: "attached", timeout: 60_000 });
  await page.evaluate("globalThis.openbotWebBench.idle()");
  return page;
}

const olderPageRequests = (page: Page) =>
  page.evaluate<number>("globalThis.openbotWebBench.calls.conversationOlder ?? 0");

async function phone(browser: Browser): Promise<LayoutReport> {
  const device = "iPhone 15 Pro";
  const page = await openStory(browser, device);
  try {
    const marker = `hidden-chat-marker-${Date.now()}`;
    const stream = await streamAndCount(page, marker);
    await page.screenshot({ path: resolve(OUT, "iphone-list.png") });
    assert.equal(stream.chatVisible, false, "The phone opens on the chat list, with the chat hidden.");
    assert.ok(
      stream.chatMutations <= HIDDEN_CHAT_MUTATION_LIMIT,
      `The hidden chat changed ${stream.chatMutations} times during a reply; at most ${HIDDEN_CHAT_MUTATION_LIMIT}.`,
    );
    assert.equal(stream.rowsAfter, stream.rowsBefore, "The hidden chat drew no new row.");
    const older = await olderPageRequests(page);
    assert.equal(older, 0, "The hidden chat asked the host for older pages.");

    // The chat catches up when it opens.
    const { open } = await page.evaluate<{ open: string }>("globalThis.openbotWebBench.agentNames");
    await page.locator(".sidebar-chat-list").getByText(open, { exact: true }).first().click();
    await page.locator(".conversation-scroll").getByText(marker).first().waitFor({ timeout: 30_000 });
    await page.evaluate("globalThis.openbotWebBench.idle()");
    await page.screenshot({ path: resolve(OUT, "iphone-chat.png") });
    return { device, stream, olderPageRequests: older, markerShownAfterOpen: true };
  } finally {
    await page.context().close();
  }
}

async function tablet(browser: Browser): Promise<LayoutReport> {
  const device = "iPad Pro 11 landscape";
  const page = await openStory(browser, device);
  try {
    const marker = `visible-chat-marker-${Date.now()}`;
    const stream = await streamAndCount(page, marker);
    assert.equal(stream.chatVisible, true, "The iPad shows the chat beside the list.");
    await page.locator(".conversation-scroll").getByText(marker).first().waitFor({ timeout: 30_000 });
    assert.ok(stream.chatMutations > 0, "The visible chat drew the reply.");
    await page.screenshot({ path: resolve(OUT, "ipad.png") });
    return { device, stream, olderPageRequests: await olderPageRequests(page) };
  } finally {
    await page.context().close();
  }
}

declare global {
  // The driver that `src/renderer/src/preview/bench-web-runtime.ts` installs in the story.
  var openbotWebBench: { stream(tokens: number, marker: string, other?: boolean): Promise<void> };
}

mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
try {
  const layouts = [await phone(browser), await tablet(browser)];
  const report = { createdAt: new Date().toISOString(), storybook, streamTokens: STREAM_TOKENS, layouts };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`${resolve(OUT, "report.json")}\n${JSON.stringify(layouts, null, 2)}`);
} finally {
  await browser.close();
}
