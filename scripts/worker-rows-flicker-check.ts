import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

/** Counts how often worker rows are torn down while the parent rebuilds its list every 50 ms. */
const base = process.argv[2] ?? "http://localhost:6031";
const label = process.argv[3] ?? "check";
const out = resolve(".openbot-build/flicker", label);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 260 },
    recordVideo: { dir: out, size: { width: 900, height: 260 } },
  });
  const page = await context.newPage();
  await page.goto(`${base}/iframe.html?id=conversation-background-workers--streaming&viewMode=story`);
  await page.locator(".background-worker-row").first().waitFor();
  await page.waitForTimeout(500);
  const stats = await page.evaluate(
    () =>
      new Promise<{ removed: number; added: number; ticks: number }>((done) => {
        const root = document.querySelector(".background-workers");
        if (!root) throw new Error("no rows");
        const first = Number(document.querySelector("output")?.dataset.tick ?? 0);
        let removed = 0;
        let added = 0;
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            removed += [...record.removedNodes].filter(
              (node) => node instanceof Element && node.matches(".background-worker-row"),
            ).length;
            added += [...record.addedNodes].filter(
              (node) => node instanceof Element && node.matches(".background-worker-row"),
            ).length;
          }
        });
        observer.observe(root, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          done({ removed, added, ticks: Number(document.querySelector("output")?.dataset.tick ?? 0) - first });
        }, 3000);
      }),
  );
  for (let index = 0; index < 6; index += 1)
    await page.screenshot({ path: resolve(out, `frame-${index}.png`) }).then(() => page.waitForTimeout(80));
  await context.close();
  process.stdout.write(`${JSON.stringify({ label, ...stats })}\n`);
  if (label === "after") assert.equal(stats.removed, 0, "rows remounted while the list was rebuilt");
} finally {
  await browser.close();
}
