// Checks that Send recovers when the web client missed the host event that said the agent is ready.
// Writes .openbot-build/web-client-missed-status/report.json, two screenshots and a video.
//
// The host sends a status event only when its status changes. An iPad web app in the background can
// miss the one that says ready, and Send then stayed disabled until a reload. The client now reads
// the status again while it is not ready.
//
// It drives the `Web/Workspace/MissedReadyStatus` story of a running Storybook, in WebKit with the
// iPad layout: `bun scripts/web-client-missed-status-e2e.ts --storybook=<url from bun run storybook>`
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { devices, webkit } from "playwright-core";

const logger = createOpenBotLogger("web-client-missed-status-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build", "web-client-missed-status");
const STORY = "web-workspace--missed-ready-status";
/** The client reads the status again every 5 seconds; this leaves room for one slow read. */
const RECOVERY_LIMIT_MS = 12_000;

const storybook = process.argv
  .find((arg) => arg.startsWith("--storybook="))
  ?.slice("--storybook=".length)
  .replace(/\/$/, "");
assert.ok(storybook, "Pass --storybook=<url> from `bun run storybook`.");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
try {
  const context = await browser.newContext({
    ...devices["iPad Pro 11 landscape"],
    recordVideo: { dir: OUT, size: { width: 1194, height: 834 } },
  });
  const page = await context.newPage();
  // A cold Storybook compiles the story on the first visit.
  await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`, { waitUntil: "commit", timeout: 120_000 });
  const editor = page.getByRole("textbox").last();
  await editor.waitFor({ timeout: 120_000 });
  await editor.click();
  await page.keyboard.type("Can you check the latest comments on my posts?");
  const send = page.getByRole("button", { name: "Send message" });
  await send.waitFor({ timeout: 10_000 });
  const disabledAtStart = await send.isDisabled();
  await page.screenshot({ path: resolve(OUT, "1-send-disabled.png") });
  const started = Date.now();
  const recovered = await page
    .waitForFunction(
      () => {
        const button = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
        return button !== null && !button.disabled;
      },
      undefined,
      { timeout: RECOVERY_LIMIT_MS },
    )
    .then(
      () => true,
      () => false,
    );
  const recoveredAfterMs = recovered ? Date.now() - started : null;
  await page.screenshot({ path: resolve(OUT, "2-after-wait.png") });
  const video = page.video();
  await context.close();
  const report = {
    story: STORY,
    disabledAtStart,
    recovered,
    recoveredAfterMs,
    recoveryLimitMs: RECOVERY_LIMIT_MS,
    video: video ? await video.path() : null,
  };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(disabledAtStart, true, "Send must start disabled while the status says starting.");
  assert.equal(recovered, true, `Send stayed disabled for ${RECOVERY_LIMIT_MS} ms after the agent was ready.`);
  logger.info("Send recovered after a missed ready event.", report);
} finally {
  await browser.close();
}
