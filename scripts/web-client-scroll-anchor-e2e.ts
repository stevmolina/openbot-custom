// Checks the reader's position when the web client receives an older page.
// Run with --storybook=<url> and optionally --browser-executable=<path>.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const storybook = option("storybook");
assert.ok(storybook, "Pass --storybook=<url>.");
const executablePath = option("browser-executable");
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
const report: { passed: boolean; checks: { page: number; before: number; after: number }[]; error?: string } = {
  passed: false,
  checks: [],
};
const output = resolve(import.meta.dirname, "../.openbot-build/web-client-scroll-anchor-e2e");
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${storybook}/iframe.html?id=web-workspace--long-conversation&viewMode=story`);
  await page.waitForFunction("globalThis.openbotWebBench !== undefined");
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.getByText("Question 158:").first().waitFor();
  await page.evaluate("globalThis.openbotWebBench.idle()");
  const scroll = page.locator(".conversation-scroll").first();
  const box = await scroll.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const [round, current] of [
    [1, 110],
    [2, 60],
  ] as const) {
    await page.evaluate("globalThis.openbotWebBench.resetCalls(); globalThis.openbotWebBench.holdOlder()");
    await scroll.evaluate((element) => {
      Object.assign(globalThis, { scrollEnded: false });
      element.addEventListener("scrollend", () => Object.assign(globalThis, { scrollEnded: true }), { once: true });
    });
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction("globalThis.scrollEnded === true");
    await page.waitForFunction("globalThis.openbotWebBench.calls.conversationOlder >= 1");
    if (round === 1) {
      await page.mouse.down();
      await scroll.evaluate((element) => {
        element.scrollTop = 300;
      });
      await page.evaluate(
        () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
      );
      const dragged = await scroll.evaluate((element) => element.scrollTop);
      assert.ok(dragged > 200, `Scrolling during a held request was reset to ${dragged}`);
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.mouse.up();
      await page.evaluate(
        () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
      );
    }
    const anchor = page.getByText(`Question ${current}:`).first();
    await anchor.waitFor();
    const position = () =>
      anchor.evaluate((element) => {
        const scrollElement = element.closest(".conversation-scroll");
        if (!scrollElement) throw new Error("Missing conversation scroll area");
        return element.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
      });
    const before = await position();
    await page.evaluate("globalThis.openbotWebBench.releaseOlder()");
    await page.evaluate("globalThis.openbotWebBench.idle()");
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
    const after = await position();
    report.checks.push({ page: round, before, after });
    assert.ok(Math.abs(after - before) <= 3, `Page ${round}: message moved from ${before} to ${after}`);
  }
  await page.reload();
  await page.waitForFunction("globalThis.openbotWebBench !== undefined");
  await page.evaluate("globalThis.openbotWebBench.ready");
  await page.getByText("Question 158:").first().waitFor();
  await page.evaluate("globalThis.openbotWebBench.idle()");
  await page.evaluate("globalThis.openbotWebBench.resetCalls(); globalThis.openbotWebBench.holdOlder()");
  await scroll.evaluate((element) => {
    Object.assign(globalThis, { scrollEnded: false });
    element.addEventListener("scrollend", () => Object.assign(globalThis, { scrollEnded: true }), { once: true });
  });
  await page.mouse.wheel(0, -10000);
  await page.waitForFunction(
    "globalThis.scrollEnded === true && globalThis.openbotWebBench.calls.conversationOlder >= 1",
  );
  await page.mouse.down();
  await scroll.evaluate((element) => {
    element.scrollTop = 300;
  });
  await page.evaluate("globalThis.openbotWebBench.releaseOlder()");
  await page.evaluate("globalThis.openbotWebBench.idle()");
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await scroll.evaluate((element) => {
    element.scrollTop = 450;
  });
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  const duringDrag = await scroll.evaluate((element) => element.scrollTop);
  assert.ok(Math.abs(duringDrag - 450) <= 3, `A page response interrupted scrolling: ${duringDrag}`);
  await page.mouse.up();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser.close();
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
