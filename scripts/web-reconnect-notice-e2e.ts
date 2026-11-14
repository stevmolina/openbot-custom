// Checks when the web app shows "Reconnecting to <server>".
// Writes .openbot-build/web-reconnect-notice/report.json, screenshots and a video.
//
// A phone pauses an installed web app each time the user leaves it, so the link to the server drops
// often and comes back in a few seconds. The notice waits 8 seconds, so a short drop shows nothing.
// A long drop still shows the notice, and the "restored" notice follows it.
//
// It drives the `Web/Workspace/ConnectionDrop` story of a running Storybook, in WebKit with the
// iPhone layout: `bun scripts/web-reconnect-notice-e2e.ts --storybook=<url from bun run storybook>`
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { devices, type Page, webkit } from "playwright-core";

const logger = createOpenBotLogger("web-reconnect-notice-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", "web-reconnect-notice");
const STORY = "web-workspace--connection-drop";
const SHORT_DROP_MS = 3_000;
/** The delay of the reconnect notice in `server-connection-toast.ts`. */
const NOTICE_DELAY_MS = 8_000;
const LONG_DROP_MS = 14_000;
const RECONNECTING = /Reconnecting to Preview computer/;
const RESTORED = /Connection to Preview computer restored/;

const storybook = process.argv
  .find((arg) => arg.startsWith("--storybook="))
  ?.slice("--storybook=".length)
  .replace(/\/$/, "");
assert.ok(storybook, "Pass --storybook=<url> from `bun run storybook`.");

/** Drops the link for `ms` and resolves when the app has connected again. */
function dropFor(page: Page, ms: number): Promise<void> {
  return page.evaluate(
    (duration) =>
      new Promise<void>((done) => {
        window.dispatchEvent(new CustomEvent("preview-connection-drop", { detail: { ms: duration, done } }));
      }),
    ms,
  );
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
try {
  const context = await browser.newContext({
    ...devices["iPhone 15 Pro"],
    recordVideo: { dir: OUT, size: { width: 393, height: 852 } },
  });
  const page = await context.newPage();
  // A cold Storybook compiles the story on the first visit.
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`, { waitUntil: "commit", timeout: 120_000 });
  await page.getByText("Preview computer").first().waitFor({ timeout: 120_000 });

  // A short drop, as after a return to the app: no notice before, during or after it.
  const reconnecting = page.getByText(RECONNECTING);
  const started = Date.now();
  const shortDrop = dropFor(page, SHORT_DROP_MS);
  // The watch lasts until one second after the app has connected again.
  const shortNotice = await Promise.race([
    reconnecting.waitFor({ timeout: 0 }).then(() => true),
    shortDrop.then(() => page.waitForTimeout(1_000)).then(() => false),
  ]);
  await shortDrop;
  const shortDropTookMs = Date.now() - started;
  await page.screenshot({ path: resolve(OUT, "short-drop-after.png") });
  // A cold Storybook can load slowly on the reconnect; the notice is then right to show.
  assert.ok(
    shortDropTookMs < NOTICE_DELAY_MS,
    `The short drop took ${shortDropTookMs} ms. Run again on a warm Storybook.`,
  );
  assert.equal(shortNotice, false, "A short drop showed the reconnect notice.");
  assert.equal(await page.getByText(RESTORED).count(), 0, "A short drop showed the restored notice.");

  // A long drop: the notice shows, then the restored notice replaces it.
  const longDrop = dropFor(page, LONG_DROP_MS);
  await reconnecting.waitFor({ timeout: LONG_DROP_MS });
  await page.screenshot({ path: resolve(OUT, "long-drop-notice.png") });
  await longDrop;
  await page.getByText(RESTORED).waitFor({ timeout: 10_000 });
  await reconnecting.waitFor({ state: "detached", timeout: 10_000 });
  await page.screenshot({ path: resolve(OUT, "long-drop-restored.png") });

  const video = page.video();
  await context.close();
  const report = {
    story: STORY,
    shortDropMs: SHORT_DROP_MS,
    shortDropTookMs,
    shortDropShowedNotice: shortNotice,
    longDropMs: LONG_DROP_MS,
    longDropShowedNotice: true,
    longDropShowedRestored: true,
    video: video ? await video.path() : null,
  };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info("web reconnect notice e2e passed", report);
} finally {
  await browser.close();
}
