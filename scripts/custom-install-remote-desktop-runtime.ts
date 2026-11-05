// Installs the pinned remote desktop runtime from release files that are already on disk.
// `scripts/custom-build-install.sh` uses it when the installer's own download fails (GitHub can
// answer HTTP 504 for a release file that `gh release download` still gets). The release lookup
// still goes to GitHub, and the installer checks each file against the checksums in
// `native-runtime.lock.json`, so a wrong file fails the same way as a bad download.
//
//   bun scripts/custom-install-remote-desktop-runtime.ts <directory with the release files>

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { installRemoteDesktopRuntime } from "./install-remote-desktop-runtime";

const directory = process.argv[2];
if (!directory) throw new Error("Give the directory that holds the downloaded release files.");
const root = resolve(directory);

async function localFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.includes("/releases/download/")) {
    return new Response(await readFile(resolve(root, basename(url.pathname))));
  }
  return fetch(input, init);
}

await installRemoteDesktopRuntime({ fetchImpl: Object.assign(localFetch, { preconnect: fetch.preconnect }) });
