// Builds the macOS photo picker and runs it in its self-test mode, which exports a file through the
// same code as a photo from the Photos grid, with no window. It checks the JSON line that the main
// process reads (`src/main/macos-photo-picker.ts`):
//   - a PNG keeps its format and its name;
//   - a HEIC photo becomes a JPEG, because the chat takes only the types in IMAGE_ATTACHMENT_EXTENSIONS;
//   - every path is a file inside the output folder;
//   - bad arguments answer an error line and a non-zero status.
// The report is `.openbot-build/macos-photo-picker-e2e.json`. macOS only.
//
//   bun scripts/macos-photo-picker-e2e.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { Option, Schema } from "effect";
import { buildMacosPhotoPicker } from "./build-macos-photo-picker";

const root = resolve(import.meta.dir, "..");
const reportPath = join(root, ".openbot-build", "macos-photo-picker-e2e.json");

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${name}: ${detail}\n`);
}

const HelperOutput = Schema.Struct({
  status: Schema.String,
  files: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String }))),
  failed: Schema.optional(Schema.Finite),
  message: Schema.optional(Schema.String),
});
type HelperOutput = typeof HelperOutput.Type;
const decodeHelperLine = Schema.decodeUnknownOption(Schema.fromJsonString(HelperOutput));

function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  return { status: result.status, json: Option.getOrNull(decodeHelperLine(line)) };
}

function fileKind(path: string) {
  const bytes = readFileSync(path).subarray(0, 8);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.subarray(1, 4).toString("ascii") === "PNG") return "png";
  return "other";
}

function exportedPaths(json: HelperOutput | null): string[] {
  return json?.files?.map((file) => file.path) ?? [];
}

if (process.platform !== "darwin") {
  process.stdout.write("The macOS photo picker runs only on macOS.\n");
  process.exit(0);
}
const executable = buildMacosPhotoPicker();
if (!executable) throw new Error("The macOS photo picker could not be built on this Mac.");

const work = mkdtempSync(join(tmpdir(), "openbot-photo-picker-e2e-"));
try {
  const png = join(work, "Sunset at the lake.png");
  writeFileSync(png, readFileSync(join(root, "build", "icon-production.png")));
  const heic = join(work, "IMG_0001.heic");
  const converted = spawnSync("sips", ["-s", "format", "heic", png, "--out", heic], { encoding: "utf8" });
  if (converted.status !== 0) throw new Error(`sips could not make the HEIC fixture: ${converted.stderr}`);

  const pngOut = join(work, "png-out");
  const pngRun = run(executable, ["--out", pngOut, "--self-test", png]);
  const [pngPath = ""] = exportedPaths(pngRun.json);
  check(
    "png keeps its format and name",
    pngRun.status === 0 &&
      pngRun.json?.status === "picked" &&
      pngRun.json.failed === 0 &&
      basename(pngPath) === "Sunset at the lake.png" &&
      existsSync(pngPath) &&
      fileKind(pngPath) === "png",
    JSON.stringify(pngRun.json),
  );
  check(
    "png path is inside the output folder",
    pngPath !== "" && !relative(resolve(pngOut), resolve(pngPath)).startsWith(".."),
    pngPath,
  );

  const heicOut = join(work, "heic-out");
  const heicRun = run(executable, ["--out", heicOut, "--self-test", heic]);
  const [heicPath = ""] = exportedPaths(heicRun.json);
  check(
    "heic becomes a jpeg",
    heicRun.status === 0 &&
      heicRun.json?.status === "picked" &&
      basename(heicPath) === "IMG_0001.jpg" &&
      existsSync(heicPath) &&
      fileKind(heicPath) === "jpeg",
    JSON.stringify(heicRun.json),
  );

  const badRun = run(executable, ["--limit", "0"]);
  check(
    "bad arguments answer an error",
    badRun.status !== 0 && badRun.json?.status === "error",
    JSON.stringify({ status: badRun.status, json: badRun.json }),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

mkdirSync(join(root, ".openbot-build"), { recursive: true });
const passed = checks.every((item) => item.passed);
writeFileSync(
  reportPath,
  `${JSON.stringify({ passed, executable: relative(root, executable), checks, at: new Date().toISOString() }, null, 2)}\n`,
);
process.stdout.write(`Report: ${reportPath}\n`);
if (!passed) process.exit(1);
