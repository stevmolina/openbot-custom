// Compiles the macOS photo picker (`scripts/macos-photo-picker.swift`) into
// `.openbot-build/macos-photo-picker/macos-photo-picker`, one universal file for Apple silicon and
// Intel Macs. Both electron-builder configs copy that folder into the app's resources. On another
// system, without the Xcode command line tools, or when the compile fails (a tools update that does
// not match the SDK), it prints why and exits 0: the app then has no Photos item, every other attach
// path still works, and the app build goes on.
//
//   bun scripts/build-macos-photo-picker.ts           build, skip when the source did not change
//   bun scripts/build-macos-photo-picker.ts --force   build again
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const source = join(root, "scripts", "macos-photo-picker.swift");
export const PHOTO_PICKER_DIRECTORY = join(root, ".openbot-build", "macos-photo-picker");
export const PHOTO_PICKER_EXECUTABLE = join(PHOTO_PICKER_DIRECTORY, "macos-photo-picker");
const stamp = join(root, ".openbot-build", "macos-photo-picker.sha256");

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}.`);
}

/** Answers the executable, or null when this system cannot build it. */
export function buildMacosPhotoPicker(force = false): string | null {
  if (process.platform !== "darwin") {
    process.stdout.write("The macOS photo picker builds only on macOS. Skipped.\n");
    return null;
  }
  if (spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }).status !== 0) {
    process.stdout.write("The macOS photo picker needs swiftc (Xcode command line tools). Skipped.\n");
    return null;
  }
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
  if (!force && existsSync(PHOTO_PICKER_EXECUTABLE) && existsSync(stamp) && readFileSync(stamp, "utf8") === hash) {
    process.stdout.write(`The macOS photo picker is up to date: ${PHOTO_PICKER_EXECUTABLE}\n`);
    return PHOTO_PICKER_EXECUTABLE;
  }
  rmSync(PHOTO_PICKER_DIRECTORY, { recursive: true, force: true });
  rmSync(stamp, { force: true });
  const work = join(root, ".openbot-build", "macos-photo-picker-work");
  try {
    compile(work);
  } catch (error) {
    rmSync(PHOTO_PICKER_DIRECTORY, { recursive: true, force: true });
    process.stdout.write(`The macOS photo picker did not build, so the app has no Photos item: ${String(error)}\n`);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(stamp, hash);
  process.stdout.write(`Built the macOS photo picker: ${PHOTO_PICKER_EXECUTABLE}\n`);
  return PHOTO_PICKER_EXECUTABLE;
}

function compile(work: string): void {
  mkdirSync(PHOTO_PICKER_DIRECTORY, { recursive: true });
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const slices: string[] = [];
  for (const architecture of ["arm64", "x86_64"]) {
    const output = join(work, architecture);
    run("xcrun", [
      "swiftc",
      "-O",
      "-swift-version",
      "5",
      "-target",
      `${architecture}-apple-macos13.0`,
      source,
      "-o",
      output,
    ]);
    slices.push(output);
  }
  run("xcrun", ["lipo", "-create", ...slices, "-output", PHOTO_PICKER_EXECUTABLE]);
  // Apple silicon runs only signed code. A release build signs the app's nested code again.
  run("codesign", ["--force", "--sign", "-", PHOTO_PICKER_EXECUTABLE]);
}

if (import.meta.main) buildMacosPhotoPicker(process.argv.includes("--force"));
