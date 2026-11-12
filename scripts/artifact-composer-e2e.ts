// Drives the real composer on its Storybook app fixture. No provider account or network calls.
// Run: bun scripts/artifact-composer-e2e.ts --storybook=http://localhost:<allocated port>
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { SendMessageInput } from "@openbot/contracts/ipc";
import { chromium } from "playwright-core";

declare global {
  interface Window {
    recordArtifactSend: (input: SendMessageInput) => Promise<void>;
  }
}

const staticRoot = process.argv.find((arg) => arg.startsWith("--static-root="))?.slice("--static-root=".length);
let base = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
// CI serves the Storybook output it already built. Local checks use the running dev Storybook.
const server = staticRoot
  ? createServer(async (request, response) => {
      const root = resolve(staticRoot);
      const path = resolve(root, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
      if (!path.startsWith(`${root}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      try {
        const bytes = await readFile(path);
        response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" }).end(bytes);
      } catch {
        response.writeHead(404).end();
      }
    })
  : undefined;
if (server) {
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No Storybook test address.");
  base = `http://127.0.0.1:${address.port}`;
}
if (!base) throw new Error("Pass the worktree's Storybook URL with --storybook=.");
const output = resolve(".openbot-build/artifact-composer-e2e");
await mkdir(output, { recursive: true });
const browser = await chromium.launch(process.env.CI ? {} : { channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60_000);
const requests: SendMessageInput[] = [];
const checks: string[] = [];
const browserErrors: string[] = [];
page.on("pageerror", (cause) => browserErrors.push(cause.message));
let error: string | undefined;
try {
  await page.exposeFunction("recordArtifactSend", (input: SendMessageInput) => requests.push(input));
  await page.goto(`${base}/iframe.html?id=conversation-composer-stack--artifact-request&viewMode=story`);
  const editor = page.getByRole("textbox", { name: "Message Chief", exact: true });
  await editor.waitFor();
  await page.evaluate(() => {
    const send = window.openbot.agent.sendMessage;
    window.openbot.agent.sendMessage = async (input, serverId) => {
      await window.recordArtifactSend(input);
      return send(input, serverId);
    };
  });
  const add = page.getByRole("button", { name: "Add to prompt", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "Create an Artifact", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "before.png"), animations: "disabled" });
  await page.getByRole("menuitem", { name: "Create an Artifact", exact: true }).click();
  const remove = page.getByRole("button", { name: "Remove Artifact mode", exact: true });
  await remove.waitFor();
  await remove.click();
  assert.equal(await remove.count(), 0);
  checks.push("The menu selects Artifact mode and the chip removes it.");
  await add.click();
  await page.getByRole("menuitem", { name: "Create an Artifact", exact: true }).click();
  await remove.waitFor();
  await editor.fill("Create a project report.");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.screenshot({ path: resolve(output, "after.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await remove.waitFor({ state: "detached" });
  await editor.fill("Ordinary follow-up.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[role="textbox"][aria-label="Message Chief"]')?.textContent === "",
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.createArtifact, true);
  assert.equal(requests[0]?.text, "Create a project report.");
  assert.equal(requests[1]?.createArtifact, undefined);
  checks.push("Send clears the chip; only the selected complete request carries Artifact mode.");
} catch (cause) {
  error = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  await page.screenshot({ path: resolve(output, "failure.png") }).catch(() => undefined);
} finally {
  await browser.close();
  if (server) await new Promise<void>((done, fail) => server.close((cause) => (cause ? fail(cause) : done())));
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify({ passed: !error, checks, requests, browserErrors, error }, null, 2)}\n`,
  );
}
// Machine-readable: repeatable E2E proof and artifact path.
process.stdout.write(`${JSON.stringify({ passed: !error, checks, browserErrors, error, output }, null, 2)}\n`);
if (error) process.exitCode = 1;
