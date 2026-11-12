/** Drives this worktree's real dev app. Writes the hold-key checks and shortcut list to a JSON report. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveLocale, translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords, selectDevInstance } from "./dev-automation/instance-registry";

const out = resolve(".openbot-build/hold-shortcuts");
mkdirSync(out, { recursive: true });
const logger = createOpenBotLogger("hold-shortcuts-smoke", (line) => process.stderr.write(`${line}\n`), "info");
const selection = selectDevInstance(readDevInstanceRecords(), { projectRoot: process.cwd() });
assert.ok(selection.kind === "selected" && selection.match === "worktree", "Start this worktree with bun run dev.");
const session = await connectToDevApp(selection.record.remoteDebuggingPort, logger, {
  expectedRendererPort: selection.record.rendererPort,
  ownerPid: selection.record.pid,
});
const { page } = session;
const mod = await page.evaluate(() => (/Mac/u.test(navigator.platform) ? "Meta" : "Control"));
const lang = await page.evaluate(() => document.documentElement.lang || navigator.language);
const t = translateFor(resolveLocale("system", lang));
const overlay = page.getByRole("status", { name: t("app.shortcuts.title"), exact: true });
const sendMessageLabel = t("composer.send.message");
const results: { name: string; passed: boolean; detail?: string }[] = [];
const hidden = async () => {
  await overlay.waitFor({ state: "hidden", timeout: 2_000 });
};
const hold = async () => {
  await page.keyboard.down(mod);
  await overlay.waitFor({ state: "visible", timeout: 3_000 });
};
const release = async () => {
  await page.keyboard.up(mod);
  await hidden();
};
const check = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    await page.mouse.up().catch(() => undefined);
    await release().catch(() => undefined);
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
  logger.info(name, results.at(-1));
};
const screenshot = (name: string) =>
  execFileSync(process.execPath, ["run", "dev:automation", "screenshot", `--out=hold-shortcuts-${name}.png`], {
    stdio: "pipe",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });

const appearance = await page.evaluate(() => window.openbot.getAppAppearancePreference());
const sendMode = await page.evaluate(() => localStorage.getItem("openbot:send-shortcut-mode"));
let shortcuts: { group: string; rows: { label: string; keys: string }[] }[] = [];
try {
  await page.bringToFront();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox").first().focus();
  await check("Hold shows after 600 ms and keeps input focus", async () => {
    const focus = await page.evaluateHandle(() => document.activeElement);
    const started = Date.now();
    await hold();
    assert.ok(Date.now() - started >= 550, "The sheet appeared before the hold threshold.");
    assert.equal(await focus.evaluate((element) => element === document.activeElement), true);
    await focus.dispose();
    shortcuts = await overlay.locator("section").evaluateAll((sections) =>
      sections.map((section) => ({
        group: section.querySelector("h3")?.textContent ?? "",
        rows: [...section.querySelectorAll("li")].map((row) => ({
          label: row.firstElementChild?.textContent ?? "",
          keys: row.querySelector(".sr-only")?.textContent ?? "",
        })),
      })),
    );
  });
  await check("Release hides", release);
  for (const theme of ["dark", "light"] as const) {
    await check(`${theme} theme proof`, async () => {
      await page.evaluate((value) => window.openbot.setAppAppearancePreference({ appearance: value }), theme);
      await page.waitForFunction(
        (value) => document.documentElement.getAttribute("data-openbot-color-scheme") === value,
        theme,
        { timeout: 2_000 },
      );
      await hold();
      screenshot(theme);
      await release();
    });
  }

  // Advance the real page's clock as input for negative cases. No elapsed-time sleeps.
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  await check("Cmd+K opens search without a sheet flash", async () => {
    const observation = await page.evaluateHandle(() => {
      const element = document.querySelector(".hold-shortcut-overlay");
      if (!element) throw new Error("The hold overlay is not mounted.");
      const state = { flashes: 0 };
      const observer = new MutationObserver((changes) => {
        state.flashes += changes.filter((change) => change.oldValue === "true").length;
      });
      observer.observe(element, { attributes: true, attributeFilter: ["aria-hidden"], attributeOldValue: true });
      return { state, observer };
    });
    try {
      await page.keyboard.press(`${mod}+k`);
      await page.getByRole("dialog").waitFor({ state: "visible", timeout: 3_000 });
      await page.clock.runFor(800);
      await hidden();
      assert.equal(await observation.evaluate((value) => value.state.flashes), 0);
      await page.keyboard.press("Escape");
    } finally {
      await observation.evaluate((value) => value.observer.disconnect());
      await observation.dispose();
    }
  });
  await check("Another key cancels and release does not restart the timer", async () => {
    await page.keyboard.down(mod);
    await page.keyboard.press("Shift");
    await page.clock.runFor(800);
    await hidden();
    await release();
  });
  await check("A key held before the modifier suppresses the sheet", async () => {
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.down(mod);
    await page.keyboard.up("ArrowLeft");
    await page.clock.runFor(800);
    await hidden();
    await release();
  });
  for (const event of ["pointerdown", "mousedown", "blur", "visibilitychange"] as const) {
    await check(`${event} cancels a pending sheet`, async () => {
      await page.keyboard.down(mod);
      await page.evaluate(
        (name) => (name === "visibilitychange" ? document : window).dispatchEvent(new Event(name)),
        event,
      );
      await page.clock.runFor(800);
      await hidden();
      await page.keyboard.up(mod);
      await page.mouse.up();
    });
    await check(`${event} hides a visible sheet`, async () => {
      await page.keyboard.down(mod);
      await page.clock.runFor(650);
      await overlay.waitFor({ state: "visible", timeout: 2_000 });
      await page.evaluate(
        (name) => (name === "visibilitychange" ? document : window).dispatchEvent(new Event(name)),
        event,
      );
      await page.clock.runFor(150);
      await hidden();
      await page.keyboard.up(mod);
      await page.mouse.up();
    });
  }
  await check("Cmd+click reaches the message box and cancels the sheet", async () => {
    const textbox = page.getByRole("textbox").first();
    await page.keyboard.down(mod);
    await page.clock.runFor(650);
    await overlay.waitFor({ state: "visible", timeout: 2_000 });
    await textbox.click();
    await page.clock.runFor(800);
    await hidden();
    assert.equal(await textbox.evaluate((element) => element === document.activeElement), true);
    await release();
  });
  await check("A second key hides a visible sheet", async () => {
    await page.keyboard.down(mod);
    await page.clock.runFor(650);
    await overlay.waitFor({ state: "visible", timeout: 2_000 });
    await page.keyboard.press("Shift");
    await page.clock.runFor(150);
    await hidden();
    await release();
  });
  await check("A pointer held before the modifier suppresses the sheet", async () => {
    await page.mouse.down();
    await page.keyboard.down(mod);
    await page.clock.runFor(800);
    await hidden();
    await page.mouse.up();
    await release();
  });
  await check("The send row follows both preference values", async () => {
    for (const mode of ["enter", "mod-enter"]) {
      await page.evaluate((value) => {
        localStorage.setItem("openbot:send-shortcut-mode", value);
        window.dispatchEvent(new StorageEvent("storage", { key: "openbot:send-shortcut-mode" }));
      }, mode);
      await page.keyboard.down(mod);
      await page.clock.runFor(650);
      const row = overlay.getByRole("listitem").filter({ hasText: sendMessageLabel });
      const text = await row.textContent();
      assert.ok(text?.includes(mode === "enter" ? "↩" : mod === "Meta" ? "⌘" : "Ctrl"));
      if (mode === "enter") assert.equal(text?.includes("⌘"), false);
      await release();
    }
  });
} finally {
  await page.clock.resume();
  await page.mouse.up().catch(() => undefined);
  await page.keyboard.up(mod);
  await page.evaluate((value) => {
    if (value === null) localStorage.removeItem("openbot:send-shortcut-mode");
    else localStorage.setItem("openbot:send-shortcut-mode", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "openbot:send-shortcut-mode" }));
  }, sendMode);
  await page.evaluate(
    (value) => window.openbot.setAppAppearancePreference({ appearance: value }),
    appearance.appearance,
  );
  await session.browser.close();
  writeFileSync(`${out}/report.json`, `${JSON.stringify({ results, shortcuts }, null, 2)}\n`);
}
assert.ok(
  results.every((result) => result.passed),
  `Failed checks: ${results
    .filter((result) => !result.passed)
    .map((result) => result.name)
    .join(", ")}`,
);
