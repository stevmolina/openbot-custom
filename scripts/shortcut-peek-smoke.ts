/**
 * Drives this worktree's running dev app (`bun run dev`) and holds the primary key (⌘ on a Mac, Ctrl
 * elsewhere) alone: the shortcut list must show, and hide on release. A quick ⌘K and a click while
 * the key is down must not show it. It writes `.openbot-build/shortcut-peek/report.json`, the rows the
 * list showed, and a screenshot in the dark and the light theme.
 *
 * Usage: bun scripts/shortcut-peek-smoke.ts [--step-delay=<ms>]
 * The delay only paces the steps for a screen recording.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords, selectDevInstance } from "./dev-automation/instance-registry";

const OUT_DIR = resolve(".openbot-build/shortcut-peek");
const OPEN = ".shortcut-peek-backdrop[data-open]";
/** The hold time in `modifier-hold.ts`, plus room for the fade. */
const HOLD_MS = 900;
const logger = createOpenBotLogger("shortcut-peek-smoke", (line) => process.stderr.write(`${line}\n`), "info");

interface CheckResult {
  name: string;
  status: "passed" | "failed";
  detail: string;
  screenshot?: string;
}

const stepDelayArgument = process.argv.find((argument) => argument.startsWith("--step-delay="));
const stepDelay = stepDelayArgument ? Number(stepDelayArgument.split("=")[1]) : 0;

async function shot(page: Page, name: string): Promise<string> {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Marks the page when the list opens at any moment, so a short flash counts too. */
async function watchForOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.documentElement;
    delete root.dataset.peekSeen;
    const seen = () => {
      if (document.querySelector(".shortcut-peek-backdrop[data-open]")) root.dataset.peekSeen = "1";
    };
    new MutationObserver(seen).observe(document.body, { attributes: true, subtree: true, childList: true });
  });
}

const openedSince = (page: Page) => page.evaluate(() => document.documentElement.dataset.peekSeen === "1");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const selection = selectDevInstance(readDevInstanceRecords(), { projectRoot: process.cwd() });
  if (selection.kind !== "selected" || selection.match !== "worktree") {
    throw new Error("Start `bun run dev` in this worktree first: the smoke test drives only its own app.");
  }
  const { record } = selection;
  const session = await connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
  });
  const { page } = session;
  const mac = await page.evaluate(() => /Mac/u.test(navigator.platform));
  const mod = mac ? "Meta" : "Control";
  const results: CheckResult[] = [];
  let rows: { group: string; label: string; keys: string }[] = [];
  const check = async (name: string, run: () => Promise<Omit<CheckResult, "name">>) => {
    try {
      results.push({ name, ...(await run()) });
    } catch (error) {
      results.push({ name, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
    logger.info(`${name}: ${results.at(-1)?.status}`, results.at(-1)?.detail ?? "");
    if (stepDelay > 0) await page.waitForTimeout(stepDelay);
  };

  try {
    await page.keyboard.press("Escape");

    await check("Hold shows the list", async () => {
      await page.keyboard.down(mod);
      try {
        await page.waitForSelector(OPEN, { timeout: 3_000 });
        await page.waitForTimeout(300);
        rows = await page.evaluate(() =>
          [...document.querySelectorAll(".shortcut-peek .shortcut-sheet-group")].flatMap((group) =>
            [...group.querySelectorAll(".shortcut-peek-row")].map((row) => ({
              group: group.querySelector(".shortcut-sheet-group-title")?.textContent ?? "",
              label: row.querySelector(".shortcut-sheet-label")?.textContent ?? "",
              keys: [...row.querySelectorAll(".shortcut-sheet-chords > *")]
                .map((part) => (part.classList.contains("shortcut-keys") ? (part.textContent ?? "") : " / "))
                .join(""),
            })),
          ),
        );
        const dialog = await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count();
        const focusInside = await page.evaluate(() => document.activeElement?.closest(".shortcut-peek") !== null);
        const screenshot = await shot(page, "peek-dark");
        // Keep the list on screen for a recording.
        await page.waitForTimeout(stepDelay);
        return {
          status: rows.length > 20 && dialog === 1 && !focusInside ? "passed" : "failed",
          detail: `${rows.length} rows; dialog by name: ${dialog}; focus moved into it: ${focusInside}`,
          screenshot,
        };
      } finally {
        await page.keyboard.up(mod);
      }
    });

    await check("Release hides the list", async () => {
      await page.waitForSelector(OPEN, { state: "detached", timeout: 3_000 });
      const dialog = await page.getByRole("dialog", { name: "Keyboard shortcuts" }).count();
      return { status: dialog === 0 ? "passed" : "failed", detail: `dialog by name after release: ${dialog}` };
    });

    await check(`${mod}+K opens search and never the list`, async () => {
      await watchForOpen(page);
      await page.keyboard.down(mod);
      await page.keyboard.press("k");
      // Keep holding after the K, as a slow hand does.
      await page.waitForTimeout(HOLD_MS);
      const search = await page.locator(".global-search-dialog").count();
      const screenshot = await shot(page, "cmd-k");
      await page.keyboard.up(mod);
      await page.keyboard.press("Escape");
      const flashed = await openedSince(page);
      return {
        status: !flashed && search > 0 ? "passed" : "failed",
        detail: `list opened: ${flashed}; search layers: ${search}`,
        screenshot,
      };
    });

    await check(`${mod}+click never shows the list`, async () => {
      await watchForOpen(page);
      await page.keyboard.down(mod);
      await page.mouse.click(5, 300);
      await page.waitForTimeout(HOLD_MS);
      await page.keyboard.up(mod);
      const flashed = await openedSince(page);
      return { status: flashed ? "failed" : "passed", detail: `list opened: ${flashed}` };
    });

    await check("List in the light theme", async () => {
      const appearance = await page.evaluate(() => window.openbot.getAppAppearancePreference());
      await page.evaluate(() => window.openbot.setAppAppearancePreference({ appearance: "light" }));
      try {
        await page.waitForTimeout(600);
        await page.keyboard.down(mod);
        await page.waitForSelector(OPEN, { timeout: 3_000 });
        await page.waitForTimeout(300);
        const screenshot = await shot(page, "peek-light");
        await page.waitForTimeout(stepDelay);
        await page.keyboard.up(mod);
        return { status: "passed", detail: `light, then ${appearance.appearance} again`, screenshot };
      } finally {
        await page.keyboard.up(mod);
        await page.evaluate(
          (value) => window.openbot.setAppAppearancePreference({ appearance: value }),
          appearance.appearance,
        );
      }
    });
  } finally {
    await session.browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    platform: mac ? "mac" : "pc",
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
    rows,
  };
  const reportPath = join(OUT_DIR, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`report saved ${reportPath}`);
  if (report.failed > 0) process.exitCode = 1;
}

await main();
