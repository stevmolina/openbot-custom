// Checks bundled artwork and image exports in this worktree's real dev renderer. It sets one
// photo on an agent with no photo, checks that it loads, then removes only that test photo.
// Start with OPENBOT_BRAND_NAME=Pokebots bun run dev, then run:
// bun scripts/pokebots-artwork-e2e.ts --allow-mutations
// Writes PNG exports, screenshots and report.json under .openbot-build/pokebots-artwork-e2e/.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { POKEBOTS_PORTRAITS, pokebotsDefaultPortrait } from "@openbot/brand/pokebots-avatar";
import type { AvatarColor, AvatarHue, ClientAgentSummary } from "@openbot/contracts/ipc";
import { brandModule, readBrandSettings } from "./brand-layer";
import { connectChannelE2e } from "./channel-e2e-support";

const root = resolve(import.meta.dirname, "..");
const out = join(root, ".openbot-build/pokebots-artwork-e2e");
await mkdir(out, { recursive: true });
const session = await connectChannelE2e("pokebots-artwork-e2e");
assert.notEqual(session.instance.profile, "default", "Use an isolated worktree profile.");
const { page } = session;
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const report: {
  passed: boolean;
  checks: string[];
  assets: Record<string, string>;
  errors: string[];
  unverified: string[];
} = {
  passed: false,
  checks: [],
  assets: {},
  errors,
  unverified: [
    "Native mobile rendering, notification/share file output and a live joined server were not run.",
    "Historical first-bot:face seeds cannot distinguish untouched onboarding from explicit face choices. They keep the saved face.",
  ],
};
let photoAgent: ClientAgentSummary | undefined;
let photoSet = false;
let appearanceAgent: ClientAgentSummary | undefined;
const identity = (agent: ClientAgentSummary) => {
  const { avatarUrl: _photo, updatedAt: _updated, ...saved } = agent;
  return saved;
};

try {
  // Load the current module graph before checking live events. A shared-module HMR update can
  // leave Solid's old context owners halted until the dev page is reloaded.
  await page.reload();
  await page.getByRole("navigation", { name: "Chat list", exact: true }).waitFor();
  const before = await page.evaluate(() => window.openbot.agent.listAgents());
  assert.ok(before.length > 0, "The worktree needs seeded agents.");
  for (const portrait of POKEBOTS_PORTRAITS) {
    const bytes = await readFile(join(root, `packages/brand/src/assets/pokebots/${portrait}.webp`));
    report.assets[portrait] = createHash("sha256").update(bytes).digest("hex");
  }
  const source = await readFile(join(root, "packages/brand/src/pokebots-avatar.ts"), "utf8");
  const settings = readBrandSettings({ OPENBOT_BRAND_NAME: "Pokebots" });
  assert.ok(settings);
  assert.ok(brandModule("packages/brand/src/pokebots-avatar.ts", source, settings)?.code.includes("ARTWORK = true;"));
  const otherBrand = readBrandSettings({ OPENBOT_BRAND_NAME: "Other" });
  assert.ok(otherBrand);
  assert.equal(brandModule("packages/brand/src/pokebots-avatar.ts", source, otherBrand), null);
  report.checks.push("Only the Pokebots Vite brand enables landing artwork.");

  // Drive the real onboarding form, then cancel the unsaved draft.
  await page.getByRole("button", { name: "New agent or channel", exact: true }).click();
  await page.getByRole("menuitem", { name: /^New agent/ }).click();
  const setup = page.getByRole("main", { name: "Create a new agent", exact: true });
  await setup.waitFor();
  const preview = setup.locator(".first-agent-live-avatar");
  const defaultSeed = await preview.getAttribute("data-avatar-seed");
  assert.match(defaultSeed ?? "", /^first-bot:default:/);
  const initialPortrait = await preview.locator("svg image").getAttribute("href");
  assert.ok(initialPortrait?.startsWith("data:image/webp;base64,"));
  await page.screenshot({ path: join(out, "onboarding-default.png") });
  const colors = setup.getByRole("group", { name: "Agent color", exact: true });
  const seenPictures = new Set<string>();
  for (const color of ["Orange", "Green", "Blue", "Violet"]) {
    const button = colors.getByRole("button", { name: `${color} agent color`, exact: true });
    await button.click();
    await page.waitForFunction(
      (label) => document.querySelector(`button[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true",
      `${color} agent color`,
    );
    const picture = await preview.locator("svg image").getAttribute("href");
    assert.ok(picture);
    assert.ok(!seenPictures.has(picture), `${color} must change the painted portrait.`);
    seenPictures.add(picture);
  }
  assert.equal(await colors.getByRole("button").count(), 5);
  await colors.getByRole("button", { name: "Automatic agent color", exact: true }).click();
  assert.equal(await preview.locator("svg image").getAttribute("href"), initialPortrait);
  await setup.getByRole("button", { name: "Agent face 1", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".first-agent-live-avatar .pokebots-portrait"));
  assert.match((await preview.getAttribute("data-avatar-seed")) ?? "", /:face:\d+$/);
  assert.equal(await colors.getByRole("button").count(), 18);
  await colors.getByRole("button", { name: "Red agent color", exact: true }).click();
  assert.equal(
    await setup.getByRole("button", { name: "Agent face 1", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: join(out, "onboarding-explicit-face.png") });
  await setup.getByRole("button", { name: /^Inbox Helper\./ }).click();
  await preview.locator("svg image").waitFor();
  assert.equal(await colors.getByRole("button").count(), 5);
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  report.checks.push(
    "Untouched onboarding previews a landing robot with a separate default seed. Explicit face choices keep their seeds.",
  );
  report.checks.push(
    "Each of the four portrait colors changes the artwork. Automatic restores it. Explicit face selection keeps its preview and all 17 colors. Suggestions restore portrait controls.",
  );

  const exported = await page.evaluate(async (repositoryRoot) => {
    const modulePath = `/@fs${repositoryRoot}/packages/ui/src/bloub-avatar.tsx`;
    const avatars: {
      createStaticAvatarSvg(seed: string, hue: AvatarHue | null, color?: AvatarColor | null): SVGSVGElement;
    } = await import(modulePath);
    const brand: { POKEBOTS_LANDING_ARTWORK: boolean } = await import(
      `/@fs${repositoryRoot}/packages/brand/src/pokebots-avatar.ts`
    );
    if (!brand.POKEBOTS_LANDING_ARTWORK) throw new Error("Restart the dev app with OPENBOT_BRAND_NAME=Pokebots.");
    const results = [];
    for (const hue of [215, 150, 30, 280] as const) {
      const svg = avatars.createStaticAvatarSvg("artwork-e2e", hue);
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", "384");
      svg.setAttribute("height", "384");
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 384;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(image, 0, 0);
      const png = canvas.toDataURL("image/png");
      const embedded = svg.querySelector("image")?.getAttribute("href");
      if (!embedded) throw new Error(`The default avatar for hue ${hue} has no bundled portrait.`);
      if (!embedded.startsWith("data:image/webp;base64,")) throw new Error("The portrait must be bundled inline.");
      const binary = atob(embedded.slice(embedded.indexOf(",") + 1));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const original = new Image();
      original.src = embedded;
      await original.decode();
      context.clearRect(0, 0, 384, 384);
      context.drawImage(original, 0, 0, 384, 384);
      results.push({ hue, digest, png, matches: png === canvas.toDataURL("image/png") });
    }
    return results;
  }, root);
  for (const result of exported) {
    const portrait = pokebotsDefaultPortrait("artwork-e2e", avatarHeadColor("artwork-e2e", result.hue));
    assert.ok(portrait);
    assert.equal(result.digest, report.assets[portrait]);
    assert.ok(result.matches, `${portrait}: the exported SVG does not draw the original pixels.`);
    await writeFile(join(out, `${portrait}-export.png`), Buffer.from(result.png.split(",")[1] ?? "", "base64"));
  }
  report.checks.push("All four SVG exports decode, preserve the bundled image bytes, and match the portrait pixels.");
  for (const seed of ["saved:face:42", "saved:flat:42", "saved:avatar:2:9"]) {
    assert.equal(pokebotsDefaultPortrait(seed, avatarHeadColor(seed, null)), null);
  }
  report.checks.push("Saved plush, flat and candidate face choices keep their existing renderer.");

  photoAgent = before.find(
    (agent) =>
      !agent.avatarUrl &&
      pokebotsDefaultPortrait(agent.avatarSeed, avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor)),
  );
  assert.ok(photoAgent, "No default agent is available for the photo round trip.");
  appearanceAgent = photoAgent;
  const legacy = await page.evaluate(
    (agentId) => window.openbot.agent.updateAgent({ agentId, avatarColor: "#a8324e" }),
    appearanceAgent.id,
  );
  const row = page
    .getByRole("navigation", { name: "Chat list", exact: true })
    .getByRole("button", { name: new RegExp(`^${appearanceAgent.name}\\.`) });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit agent", exact: true }).click();
  await page.getByRole("button", { name: "Edit agent avatar", exact: true }).click();
  const editorColors = page.getByRole("group", { name: "Avatar color", exact: true });
  await editorColors.waitFor();
  assert.equal(await editorColors.getByRole("button").count(), 5);
  const selected = editorColors.locator('button[aria-pressed="true"]');
  assert.equal(await selected.count(), 1);
  const savedOnOpen = await page.evaluate(
    async (id) => (await window.openbot.agent.listAgents()).find((agent) => agent.id === id),
    appearanceAgent.id,
  );
  assert.equal(savedOnOpen?.avatarHue, legacy.avatarHue);
  assert.equal(savedOnOpen?.avatarColor, legacy.avatarColor);
  const selectedPicture = pokebotsDefaultPortrait(
    legacy.avatarSeed,
    avatarHeadColor(legacy.avatarSeed, legacy.avatarHue, legacy.avatarColor),
  );
  const labels = { blue: "Blue", mint: "Green", orange: "Orange", purple: "Violet" };
  assert.ok(selectedPicture);
  assert.equal(await selected.getAttribute("aria-label"), `${labels[selectedPicture]} avatar color`);
  await editorColors.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "settings-saved-color.png") });
  for (const [name, hue] of [
    ["Orange", 30],
    ["Green", 150],
    ["Blue", 215],
    ["Violet", 280],
  ] as const) {
    await editorColors.getByRole("button", { name: `${name} avatar color`, exact: true }).click();
    await page.waitForFunction(
      async ({ id, hue }) => {
        const agent = (await window.openbot.agent.listAgents()).find((entry) => entry.id === id);
        return agent?.avatarHue === hue && !agent.avatarColor;
      },
      { id: appearanceAgent.id, hue },
    );
  }
  // Choosing the default geometry must save the explicit face shown in the picker.
  await page.getByRole("group", { name: "Avatar shapes", exact: true }).locator('button[aria-pressed="true"]').click();
  await page.waitForFunction(
    async (id) =>
      /:face:\d+$/.test((await window.openbot.agent.listAgents()).find((agent) => agent.id === id)?.avatarSeed ?? ""),
    appearanceAgent.id,
  );
  assert.equal(await editorColors.getByRole("button").count(), 18);
  await page.getByRole("button", { name: "Reset to ID", exact: true }).click();
  await page.waitForFunction(
    async (id) => (await window.openbot.agent.listAgents()).find((agent) => agent.id === id)?.avatarSeed === id,
    appearanceAgent.id,
  );
  assert.equal(await editorColors.getByRole("button").count(), 5);
  await editorColors.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "settings-reset-robot.png") });
  await page.evaluate(
    (agent) =>
      window.openbot.agent.updateAgent({
        agentId: agent.id,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarColor: agent.avatarColor ?? null,
      }),
    appearanceAgent,
  );
  appearanceAgent = undefined;
  await page.reload();
  await page.getByRole("navigation", { name: "Chat list", exact: true }).waitFor();
  report.checks.push(
    "Opening settings preserves a saved exact color and selects its painted robot. All four colors persist. Selecting the default shape saves its explicit face, and Reset to ID restores robot controls.",
  );

  const bytes = await readFile(join(root, "packages/ui/src/features/agents/assets/pokebots/dev.webp"));
  const uploaded = await page.evaluate(
    ({ agentId, image }) =>
      window.openbot.agent.setAvatar({ agentId, image: { mimeType: "image/webp", bytes: new Uint8Array(image) } }),
    { agentId: photoAgent.id, image: Array.from(bytes) },
  );
  photoSet = true;
  assert.ok(uploaded.avatarUrl);
  assert.deepEqual(identity(uploaded), identity(photoAgent));
  await page.waitForFunction(
    (url) => Array.from(document.images).some((image) => image.src === url && image.complete && image.naturalWidth > 0),
    uploaded.avatarUrl,
  );
  await page.screenshot({ path: join(out, "custom-photo.png") });
  report.checks.push("A custom photo loads in the real app without changing the agent identity or saved settings.");
  await page.evaluate((agentId) => window.openbot.agent.setAvatar({ agentId, image: null }), photoAgent.id);
  photoSet = false;
  await page.waitForFunction(
    (url) => !Array.from(document.images).some((image) => image.src === url),
    uploaded.avatarUrl,
  );
  const after = await page.evaluate(() => window.openbot.agent.listAgents());
  assert.deepEqual(after.map(identity), before.map(identity));
  assert.deepEqual(
    after.map((agent) => agent.avatarUrl),
    before.map((agent) => agent.avatarUrl),
  );
  report.checks.push(
    "Removing the test photo restores default artwork and preserves all saved agent fields except the edit date.",
  );
  await page.screenshot({ path: join(out, "default-portraits.png") });
  assert.deepEqual(errors, []);
  report.passed = true;
} finally {
  if (appearanceAgent)
    await page.evaluate(
      (agent) =>
        window.openbot.agent.updateAgent({
          agentId: agent.id,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarColor: agent.avatarColor ?? null,
        }),
      appearanceAgent,
    );
  if (photoSet && photoAgent) {
    await page.evaluate((agentId) => window.openbot.agent.setAvatar({ agentId, image: null }), photoAgent.id);
  }
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
  // Machine-readable: E2E proof for the parent reviewer.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
