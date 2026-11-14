// The macOS photo picker: the Photos grid of the system (PHPickerViewController), shown by the small
// helper program that `scripts/macos-photo-picker.swift` builds. It copies the chosen photos and videos
// into a new temporary folder and answers their paths. The attachment handler then prepares or uploads
// them like files from the file dialog, and removes the folder.
//
// It needs this computer: its Photos library and its OS picker. A joined server gets the files, not
// the picker, so the remote path is the upload that the file dialog uses too.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** PHPicker runs on macOS 13 (Darwin 22) and later. */
const FIRST_DARWIN_WITH_PHOTO_PICKER = 22;
const EXECUTABLE_NAME = "macos-photo-picker";
const OUTPUT_LIMIT_BYTES = 1024 * 1024;

export class PhotoPickerFailed extends Schema.TaggedError<PhotoPickerFailed>()("PhotoPickerFailed", {
  cause: Schema.Defect(),
}) {}

const { io } = causeHelpers(PhotoPickerFailed);

export interface PhotoPickerLocation {
  packaged: boolean;
  resourcesPath: string;
}

/**
 * The helper, or null where it cannot run: another system, macOS before 13, or a build without it.
 * A development run uses the copy that `bun run prepare:macos-photo-picker` builds.
 */
export function photoPickerExecutable(location: PhotoPickerLocation): string | null {
  if (process.platform !== "darwin") return null;
  if (Number.parseInt(release(), 10) < FIRST_DARWIN_WITH_PHOTO_PICKER) return null;
  const path = location.packaged
    ? join(location.resourcesPath, EXECUTABLE_NAME, EXECUTABLE_NAME)
    : resolve(".openbot-build", EXECUTABLE_NAME, EXECUTABLE_NAME);
  return existsSync(path) ? path : null;
}

export interface PhotoPickerRequest {
  executable: string;
  /** Offer videos too. Only for a host that takes them. */
  videos: boolean;
  /** How many items the grid lets the user select. */
  limit: number;
  title: string;
}

/** The copies of the chosen items, in the order of the selection. The caller removes `directory`. */
export interface PickedPhotos {
  directory: string;
  paths: string[];
}

/** The user reads one sentence for every failure; the cause stays on the error for the log. */
function failure(cause: unknown): PhotoPickerFailed {
  return new PhotoPickerFailed({ cause: new Error(sourceText("error.attachment.photoPickerFailed"), { cause }) });
}

function runHelper(executable: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(executable, args, { maxBuffer: OUTPUT_LIMIT_BYTES, encoding: "utf8" }, (error, stdout) => {
      // The helper prints its own error as JSON and exits non-zero; that line is the answer.
      if (error && !stdout.trim()) reject(error);
      else resolvePromise(stdout);
    });
  });
}

/** The one JSON line that the helper prints (`scripts/macos-photo-picker.swift`). */
const HelperOutput = Schema.Union([
  Schema.Struct({ status: Schema.Literal("cancelled") }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({
    status: Schema.Literal("picked"),
    files: Schema.Array(Schema.Struct({ path: Schema.String })),
    failed: Schema.Finite,
  }),
]);
const decodeHelperLine = Schema.decodeUnknownSync(Schema.fromJsonString(HelperOutput));

/**
 * Reads the answer of the helper: null for a cancel, else the copied files. Every path must be a file
 * inside `directory`. Items that the helper could not copy are left out; none copied is an error.
 */
function decodeHelperOutput(output: string, directory: string): string[] | null {
  const result = decodeHelperLine(output.trim().split("\n").at(-1) ?? "");
  if (result.status === "cancelled") return null;
  if (result.status === "error") throw new Error(result.message);
  const paths = result.files.map((file) => {
    const path = resolve(file.path);
    const inside = relative(directory, path);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error("A file outside the folder.");
    return path;
  });
  if (paths.length === 0) throw new Error("No chosen item could be copied.");
  return paths;
}

let pickerOpen = false;

/**
 * Shows the picker and waits for the user. A cancel, or a second request while one picker is open,
 * answers null. The folder is removed on every path but success.
 */
export const pickPhotos = Effect.fn("PhotoPicker.pick")(function* (request: PhotoPickerRequest) {
  if (pickerOpen) return null;
  pickerOpen = true;
  return yield* Effect.gen(function* () {
    const directory = yield* io(() => mkdtemp(join(tmpdir(), "openbot-photos-")));
    const removeFolder = io(() => rm(directory, { recursive: true, force: true })).pipe(Effect.ignore);
    const args = ["--out", directory, "--limit", String(request.limit), "--title", request.title];
    if (request.videos) args.push("--videos");
    const paths = yield* Effect.tryPromise({
      try: async () => decodeHelperOutput(await runHelper(request.executable, args), directory),
      catch: failure,
    }).pipe(Effect.tapError(() => removeFolder));
    if (paths === null) {
      yield* removeFolder;
      return null;
    }
    return { directory, paths } satisfies PickedPhotos;
  }).pipe(Effect.ensuring(Effect.sync(() => (pickerOpen = false))));
});
