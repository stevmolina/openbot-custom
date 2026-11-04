// Run against this worktree's Storybook dev server. Does not read or change user data.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { chatVisualPageUrl } from "../src/renderer/src/features/conversation/chat-visual-url";

const base = process.argv[2] ?? "http://localhost:6006";
const out = resolve(".openbot-build/thread-visual-reply");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report: { scenario: string; result: string }[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const scenario of ["desktop", "web", "unavailable"]) {
    await page.goto(`${base}/iframe.html?id=conversation-thread-visual-replies--${scenario}&viewMode=story`);
    if (scenario === "unavailable") {
      await page.getByText("Cannot load Inline HTML demo", { exact: true }).waitFor();
      assert.equal(await page.locator('iframe[title="Inline HTML demo"]').count(), 0);
    } else {
      const frame = page.frameLocator('iframe[title="Inline HTML demo"]');
      await frame.getByText("Inline page script ran", { exact: true }).waitFor();
      assert.equal(
        await page.locator('iframe[title="Inline HTML demo"]').getAttribute("sandbox"),
        "allow-scripts allow-forms",
      );
      assert.equal(
        await frame.locator("body").evaluate(() => {
          try {
            return window.parent.document !== undefined;
          } catch {
            return false;
          }
        }),
        false,
        "The page must not read the host document",
      );
    }
    await page.getByText("ordinary.html", { exact: true }).waitFor();
    assert.equal(await page.locator('iframe[title="Ordinary HTML attachment"]').count(), 0);
    await page.screenshot({ path: resolve(out, `${scenario}.png`), fullPage: true });
    report.push({ scenario, result: "passed" });
  }
  assert.equal(chatVisualPageUrl("openbot-attachment://file/example"), "openbot-visual://file/example");
  assert.equal(
    chatVisualPageUrl("openbot-remote-attachment://server/example"),
    "openbot-remote-visual://server/example",
  );
  assert.equal(chatVisualPageUrl("https://example.com/page"), undefined);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ report, errors }, null, 2));
  process.stdout.write(`${JSON.stringify({ report, errors, artifacts: out }, null, 2)}\n`);
} finally {
  await browser.close();
}
