import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:6023";
const out = resolve(".openbot-build/background-workers");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/iframe.html?id=conversation-background-workers--reference-row&viewMode=story`);
  const row = page.getByRole("button", { name: /Add background worker visibility/ });
  await row.waitFor();
  assert.match(await row.innerText(), /Running/);
  assert.match(await row.innerText(), /1m/);
  assert.equal(await row.locator(".agent-avatar").count(), 1);
  assert.equal(await row.locator(".provider-logo").count(), 0);
  await page.screenshot({ path: resolve(out, "reference-row.png") });
  await row.click();
  await page.getByText("Worker details opened").waitFor();
  assert.equal(await row.count(), 0);
  checks.push("Bot-only row shows real elapsed status and click opens details; settled activity disappears");
  await page.goto(`${base}/iframe.html?id=conversation-agent-threads--no-tabs&viewMode=story`);
  const task = page.getByRole("button", { name: /Competitor scan.*Running/ });
  await task.waitFor().catch(async (error) => {
    process.stdout.write(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(-7000) }));
    throw error;
  });
  await page.getByRole("button", { name: /Check broken links.*Queued/ }).waitFor();
  await page.screenshot({ path: resolve(out, "conversation.png") });
  await task.click();
  await page.getByText("Reading three pricing pages", { exact: true }).first().waitFor();
  checks.push(
    "Real app shows background tasks even without open tabs, queued state, and navigates to task conversation",
  );
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, errors };
  writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
}
