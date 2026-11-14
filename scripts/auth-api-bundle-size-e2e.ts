/**
 * E2E check of the account Worker's cold-start weight.
 *
 * A Worker evaluates the modules that `dist/server/index.js` imports statically before its first
 * request. This script builds the Worker (`bun run build` in `apps/auth-api`, skip it with
 * `--skip-build`), follows those static imports, and writes the size of that set and its biggest
 * chunks to `.openbot-build/auth-api-bundle-size.json`. It fails when the set holds a desktop UI
 * module, a translated catalog, or more bytes than `MAX_STATIC_BYTES`.
 *
 * Rolldown writes a `// <source path>` comment above each module, so the checks read source paths.
 *
 *   bun scripts/auth-api-bundle-size-e2e.ts [--skip-build]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = join(projectRoot, "apps", "auth-api");
const serverRoot = join(apiRoot, "dist", "server");
const reportPath = join(projectRoot, ".openbot-build", "auth-api-bundle-size.json");

/** The set was 33.9 MB when the `@openbot/contracts/ipc` barrel was imported. It is about 4 MB now. */
const MAX_STATIC_BYTES = 6 * 1024 * 1024;

/** A source path in the static set that makes the Worker slower to start, and why. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /(?:^|\/)src\/renderer\//, reason: "desktop renderer" },
  // The site shows the app store links from `features/mobile-app`, so that folder is allowed.
  { pattern: /(?:^|\/)packages\/ui\/src\/features\/(?!mobile-app\/)/, reason: "shared desktop UI features" },
  { pattern: /(?:^|\/)packages\/i18n\/src\/messages\/(?!en\/)[^/]+\//, reason: "translated catalog" },
  { pattern: /(?:^|\/)packages\/i18n\/src\/(?:source|app)-catalogs\.ts$/, reason: "all-language catalog index" },
];

const IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[^"';]*?from\s*)?"(\.\/[^"]+)"/g;

function main(): void {
  if (!process.argv.includes("--skip-build")) {
    const build = spawnSync("bun", ["run", "build"], { cwd: apiRoot, stdio: "inherit" });
    if (build.status !== 0) fail("The auth-api build failed.");
  }

  const chunks = new Map<string, string>();
  const pending = ["index.js"];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || chunks.has(file)) continue;
    const text = readFileSync(join(serverRoot, file), "utf8");
    chunks.set(file, text);
    for (const match of text.matchAll(IMPORT)) {
      if (match[1]) pending.push(normalize(join(dirname(file), match[1])));
    }
  }

  const modules = new Set<string>();
  for (const text of chunks.values()) {
    for (const match of text.matchAll(/^\/\/ (\.\.\/[^\n]+)$/gm)) {
      if (match[1]) modules.add(match[1]);
    }
  }

  const violations: string[] = [];
  for (const path of modules) {
    for (const rule of FORBIDDEN) if (rule.pattern.test(path)) violations.push(`${rule.reason}: ${path}`);
  }

  let rawBytes = 0;
  const sizes: { file: string; bytes: number; gzipBytes: number }[] = [];
  for (const [file, text] of chunks) {
    const bytes = Buffer.byteLength(text);
    rawBytes += bytes;
    sizes.push({ file, bytes, gzipBytes: gzipSync(text).length });
  }
  sizes.sort((a, b) => b.bytes - a.bytes);
  const gzipBytes = sizes.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    staticChunks: chunks.size,
    staticModules: modules.size,
    staticBytes: rawBytes,
    staticGzipBytes: gzipBytes,
    maxStaticBytes: MAX_STATIC_BYTES,
    allChunks: readdirSync(join(serverRoot, "assets")).length,
    allBytes: totalBytes(serverRoot),
    topChunks: sizes.slice(0, 5),
    violations,
    passed: violations.length === 0 && rawBytes <= MAX_STATIC_BYTES,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, topChunks: undefined }, null, 2)}\nReport: ${reportPath}\n`);

  if (violations.length > 0) fail(`Forbidden modules load at Worker start:\n${violations.slice(0, 20).join("\n")}`);
  if (rawBytes > MAX_STATIC_BYTES) fail(`The static set is ${rawBytes} bytes, over ${MAX_STATIC_BYTES}.`);
}

function totalBytes(directory: string): number {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? totalBytes(path) : statSync(path).size;
  }
  return total;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main();
