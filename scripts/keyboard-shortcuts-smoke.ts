/**
 * Drives this worktree's running dev app (`bun run dev`) and presses the app's keyboard shortcuts:
 * the shortcut sheet, the sidebar toggle, the chat and unread chat steps, the message box focus,
 * typing to the message box, copying the last reply, and New Chat. Each check reads the result from
 * the page. It writes `.openbot-build/keyboard-shortcuts/report.json` and a screenshot of each step.
 *
 * Usage: bun scripts/keyboard-shortcuts-smoke.ts [--step-delay=<ms>]
 * The delay only paces the steps for a screen recording.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords, selectDevInstance } from "./dev-automation/instance-registry";

const OUT_DIR = resolve(".openbot-build/keyboard-shortcuts");
const logger = createOpenBotLogger("keyboard-shortcuts-smoke", (line) => process.stderr.write(`${line}\n`), "info");

interface CheckResult {
  name: string;
  keys: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
  screenshot?: string;
}

const stepDelayArgument = process.argv.find((argument) => argument.startsWith("--step-delay="));
const stepDelay = stepDelayArgument ? Number(stepDelayArgument.split("=")[1]) : 0;

async function pace(page: Page): Promise<void> {
  if (stepDelay > 0) await page.waitForTimeout(stepDelay);
}

async function shot(page: Page, name: string): Promise<string> {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Moves the focus to nothing, as after a click on the transcript. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

const activeChat = (page: Page) =>
  page.evaluate(
    () => document.querySelector("[data-sidebar-chat][aria-current='page']")?.getAttribute("data-sidebar-chat") ?? null,
  );

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
  const check = async (name: string, keys: string, run: () => Promise<Omit<CheckResult, "name" | "keys">>) => {
    try {
      const result = await run();
      results.push({ name, keys, ...result });
    } catch (error) {
      results.push({ name, keys, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
    logger.info(`${name}: ${results.at(-1)?.status}`, results.at(-1)?.detail ?? "");
    await pace(page);
  };

  try {
    await page.keyboard.press("Escape");
    await blur(page);

    await check("Shortcut sheet opens", `${mod}+/`, async () => {
      await page.keyboard.press(`${mod}+/`);
      await page.waitForSelector(".shortcut-sheet", { timeout: 3_000 });
      await page.waitForTimeout(400);
      const rows = await page.locator(".shortcut-sheet-row").count();
      const groups = await page.locator(".shortcut-sheet-group-title").allTextContents();
      // The sheet must be on screen, not only in the page.
      const onScreen = await page.evaluate(() => {
        const box = document.querySelector(".shortcut-sheet")?.getBoundingClientRect();
        return (
          box !== undefined && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
        );
      });
      return {
        status: rows > 20 && onScreen ? "passed" : "failed",
        detail: `${rows} rows in ${groups.join(", ")}; on screen: ${onScreen}`,
        screenshot: await shot(page, "sheet-dark"),
      };
    });

    await check("Sheet filter", "type", async () => {
      await page.keyboard.type("copy", { delay: stepDelay > 0 ? 80 : 0 });
      await page.waitForTimeout(200);
      const labels = await page.locator(".shortcut-sheet-label").allTextContents();
      const screenshot = await shot(page, "sheet-filter");
      return {
        status: labels.length > 0 && labels.every((label) => /copy/iu.test(label)) ? "passed" : "failed",
        detail: labels.join(", "),
        screenshot,
      };
    });

    await check("Sheet closes", "Escape", async () => {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".shortcut-sheet", { state: "detached", timeout: 3_000 });
      return { status: "passed", detail: "closed" };
    });

    await check("? opens the sheet outside a text field", "?", async () => {
      await blur(page);
      await page.keyboard.press("Shift+Slash");
      await page.waitForSelector(".shortcut-sheet", { timeout: 3_000 });
      await page.keyboard.press(`${mod}+/`);
      await page.waitForSelector(".shortcut-sheet", { state: "detached", timeout: 3_000 });
      return { status: "passed", detail: "opened with ?, closed with the same chord that opens it" };
    });

    await check("Sidebar toggles", `${mod}+B`, async () => {
      const expanded = () =>
        page.evaluate(() => document.querySelector(".sidebar-chat-toggle")?.getAttribute("aria-expanded") ?? null);
      const before = await expanded();
      await page.keyboard.press(`${mod}+b`);
      await page.waitForFunction(
        (value) => document.querySelector(".sidebar-chat-toggle")?.getAttribute("aria-expanded") !== value,
        before,
        { timeout: 3_000 },
      );
      const middle = await expanded();
      const screenshot = await shot(page, "sidebar-collapsed");
      await pace(page);
      await page.keyboard.press(`${mod}+b`);
      await page.waitForFunction(
        (value) => document.querySelector(".sidebar-chat-toggle")?.getAttribute("aria-expanded") === value,
        before,
        { timeout: 3_000 },
      );
      return { status: "passed", detail: `aria-expanded ${before} -> ${middle} -> ${before}`, screenshot };
    });

    await check("Next and previous chat", "Alt+↓ / Alt+↑", async () => {
      await page.waitForTimeout(300);
      const start = await activeChat(page);
      await page.keyboard.press("Alt+ArrowUp");
      await page.waitForFunction(
        (value) =>
          document.querySelector("[data-sidebar-chat][aria-current='page']")?.getAttribute("data-sidebar-chat") !==
          value,
        start,
        { timeout: 3_000 },
      );
      const moved = await activeChat(page);
      const screenshot = await shot(page, "previous-chat");
      await pace(page);
      await page.keyboard.press("Alt+ArrowDown");
      await page.waitForFunction(
        (value) =>
          document.querySelector("[data-sidebar-chat][aria-current='page']")?.getAttribute("data-sidebar-chat") ===
          value,
        start,
        { timeout: 3_000 },
      );
      return { status: "passed", detail: `${start} -> ${moved} -> ${start}`, screenshot };
    });

    await check("Next unread chat", "Alt+Shift+↓ or ↑", async () => {
      // The unread rows, and whether one is below the open chat: the key then steps down to it.
      const { unread, below } = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("[data-sidebar-chat]")];
        const current = rows.findIndex((row) => row.getAttribute("aria-current") === "page");
        const unreadRows = rows.filter((row) => row.hasAttribute("data-unread"));
        return {
          unread: unreadRows.map((row) => row.getAttribute("data-sidebar-chat")),
          below: unreadRows.some((row) => rows.indexOf(row) > current),
        };
      });
      if (unread.length === 0) return { status: "skipped", detail: "no unread chat in this profile" };
      const start = await activeChat(page);
      await page.keyboard.press(below ? "Alt+Shift+ArrowDown" : "Alt+Shift+ArrowUp");
      await page.waitForFunction(
        (value) =>
          document.querySelector("[data-sidebar-chat][aria-current='page']")?.getAttribute("data-sidebar-chat") !==
          value,
        start,
        { timeout: 3_000 },
      );
      const moved = await activeChat(page);
      return {
        status: moved !== null && unread.includes(moved) ? "passed" : "failed",
        detail: `${start} -> ${moved}; unread rows were ${unread.join(", ")}`,
        screenshot: await shot(page, "unread-chat"),
      };
    });

    // The seeded Chief chat ends with a reply that has a code block.
    const chief = page.locator("[data-sidebar-chat='agent:chief']");
    if ((await chief.count()) > 0) {
      await chief.first().click();
      await page.waitForTimeout(500);
    }
    const composerEditable = await page.evaluate(
      () => document.querySelector(".composer-editor-surface[contenteditable='true']") !== null,
    );

    await check("Focus the message box", "Shift+Escape", async () => {
      if (!composerEditable) return { status: "skipped", detail: "the message box is locked in this profile" };
      await blur(page);
      await page.keyboard.press("Shift+Escape");
      const focused = await page.evaluate(() => document.activeElement?.classList.contains("composer-editor-surface"));
      return { status: focused ? "passed" : "failed", detail: `message box focused: ${focused}` };
    });

    await check("Typing goes to the message box", "h", async () => {
      if (!composerEditable) return { status: "skipped", detail: "the message box is locked in this profile" };
      await blur(page);
      await page.keyboard.type("hi");
      let state: { focused: boolean; text: string };
      let screenshot: string;
      try {
        state = await page.evaluate(() => ({
          focused: document.activeElement?.classList.contains("composer-editor-surface") ?? false,
          text: document.activeElement?.textContent ?? "",
        }));
        screenshot = await shot(page, "type-to-composer");
      } finally {
        // Leave the draft as it was.
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
      }
      return {
        status: state.focused && state.text.includes("hi") ? "passed" : "failed",
        detail: JSON.stringify(state),
        screenshot,
      };
    });

    await check("Copy the last reply", `${mod}+Shift+C`, async () => {
      await blur(page);
      await page.keyboard.press(`${mod}+Shift+c`);
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: /reply/iu }).first();
      await toast.waitFor({ timeout: 3_000 });
      const text = (await toast.textContent()) ?? "";
      return {
        status: /copied/iu.test(text) ? "passed" : "failed",
        detail: text,
        screenshot: await shot(page, "copy-last-reply"),
      };
    });

    await check("Copy the last code block", `${mod}+Shift+;`, async () => {
      await page.waitForTimeout(500);
      await page.keyboard.press(`${mod}+Shift+Semicolon`);
      const toast = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /code block/iu })
        .first();
      await toast.waitFor({ timeout: 3_000 });
      const text = (await toast.textContent()) ?? "";
      return { status: /copied/iu.test(text) ? "passed" : "failed", detail: text };
    });

    await check("Tooltip names the key", "hover", async () => {
      await page.locator(".sidebar-chat-top button[aria-keyshortcuts]").first().hover();
      const tooltip = page.locator(".shortcut-label").first();
      await tooltip.waitFor({ timeout: 3_000 });
      const text = (await tooltip.textContent()) ?? "";
      const screenshot = await shot(page, "tooltip");
      await page.mouse.move(900, 600);
      return { status: /K/u.test(text) ? "passed" : "failed", detail: text, screenshot };
    });

    await check("New chat", `${mod}+N`, async () => {
      await blur(page);
      await page.keyboard.press(`${mod}+n`);
      await page.waitForTimeout(800);
      const screenshot = await shot(page, "new-chat");
      const form = await page.evaluate(() => document.body.innerText.includes("Create agent"));
      await page
        .getByRole("button", { name: "Cancel" })
        .first()
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      return {
        status: form ? "passed" : "failed",
        detail: `the new agent form shows: ${form}`,
        screenshot,
      };
    });

    await check("Sheet in the light theme", `${mod}+/`, async () => {
      const appearance = await page.evaluate(() => window.openbot.getAppAppearancePreference());
      await page.evaluate(() => window.openbot.setAppAppearancePreference({ appearance: "light" }));
      let screenshot: string;
      try {
        await page.waitForTimeout(600);
        await blur(page);
        await page.keyboard.press(`${mod}+/`);
        await page.waitForSelector(".shortcut-sheet", { timeout: 3_000 });
        await page.waitForTimeout(400);
        screenshot = await shot(page, "sheet-light");
        await page.keyboard.press("Escape");
      } finally {
        await page.evaluate(
          (value) => window.openbot.setAppAppearancePreference({ appearance: value }),
          appearance.appearance,
        );
      }
      return { status: "passed", detail: `appearance light, then ${appearance.appearance} again`, screenshot };
    });
  } finally {
    await session.browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    platform: mac ? "mac" : "pc",
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
  const reportPath = join(OUT_DIR, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`report saved ${reportPath}`);
  if (report.failed > 0) process.exitCode = 1;
}

await main();
