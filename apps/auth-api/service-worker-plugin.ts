import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Plugin } from "vite";
import { brandText, readBrandSettings } from "../../scripts/brand-layer";

const TEMPLATE = new URL("./service-worker/app-sw.js", import.meta.url);
/** The file name at the site root. A script at the root may take the scope `/app`. */
export const WEB_SERVICE_WORKER_FILE = "app-sw.js";
const MANIFEST_FILE = "site.webmanifest";
const BRANDED_MANIFEST_KEYS = new Set(["name", "short_name", "description"]);

/**
 * Emits `app-sw.js`, the service worker of the web client, into the client build. Its build id is a
 * hash of the names of the files in the build. Vite puts a content hash in each name, so the bytes of
 * the worker change when, and only when, the web client changes, and a browser that checks the file
 * sees a new version.
 *
 * `vite dev` serves the same file at the same address with the build id `dev`. The worker keeps no
 * `/assets/` file there, because the dev server has none, and it answers `/app` from the network, so it
 * hides no edit. It is there so that push and the update prompt can be tried while developing.
 *
 * With `OPENBOT_BRAND_NAME` set, the worker's app name and the manifest's names carry the brand name.
 */
export function webServiceWorker(env: Readonly<Record<string, string | undefined>> = process.env): Plugin {
  const brand = readBrandSettings(env);
  const appName = brand?.name ?? "OpenBot";
  const workerSource = (template: string, buildId: string) =>
    template.replace("__OPENBOT_BUILD_ID__", buildId).replace("__OPENBOT_APP_NAME__", appName);
  return {
    name: "openbot-web-service-worker",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if ((request.url ?? "").split("?")[0] !== `/${WEB_SERVICE_WORKER_FILE}`) {
          next();
          return;
        }
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(workerSource(readFileSync(TEMPLATE, "utf8"), "dev"));
      });
    },
    generateBundle(_options, bundle) {
      // The Worker build gets no copy: only the client build is served as files.
      if (this.environment.name !== "client") return;
      const template = readFileSync(TEMPLATE, "utf8");
      const hash = createHash("sha256").update(template).update(appName);
      for (const name of Object.keys(bundle).sort()) hash.update(name).update("\n");
      const source = workerSource(template, hash.digest("hex").slice(0, 16));
      this.emitFile({ type: "asset", fileName: WEB_SERVICE_WORKER_FILE, source });
    },
    // The public folder, with the manifest, is copied before the bundle is written.
    writeBundle(options) {
      if (!brand || !options.dir || this.environment.name !== "client") return;
      const path = join(options.dir, MANIFEST_FILE);
      try {
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        if (!isDynamicRecord(manifest)) throw new Error("The manifest is not an object.");
        const branded = Object.fromEntries(
          Object.entries(manifest).map(([key, value]) => [
            key,
            BRANDED_MANIFEST_KEYS.has(key) && typeof value === "string" ? brandText(value, brand.name) : value,
          ]),
        );
        writeFileSync(path, `${JSON.stringify(branded, null, 2)}\n`);
      } catch (error) {
        this.warn(`The brand layer could not change ${MANIFEST_FILE}: ${String(error)}`);
      }
    },
  };
}
