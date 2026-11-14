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
  unverified: ["Native mobile rendering and a live joined server were not run."],
};
let photoAgent: ClientAgentSummary | undefined;
let photoSet = false;
const identity = (agent: ClientAgentSummary) => {
  const { avatarUrl: _photo, updatedAt: _updated, ...saved } = agent;
  return saved;
};

try {
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
  if (photoSet && photoAgent) {
    await page.evaluate((agentId) => window.openbot.agent.setAvatar({ agentId, image: null }), photoAgent.id);
  }
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
  // Machine-readable: E2E proof for the parent reviewer.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
