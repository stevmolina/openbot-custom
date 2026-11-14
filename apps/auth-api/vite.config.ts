import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { lazyLanguageCatalogs } from "../../packages/i18n/src/vite-plugin";
import { brandPlugins } from "../../scripts/brand-layer";
import { tailwindPropertyFallbackRemoval } from "../../scripts/tailwind-property-fallback";
import { webClientStylesheet } from "../../scripts/web-stylesheet";
import { contentImages } from "./content-images";
import { DEVELOPMENT_APNS_PATH, developmentApnsProxy } from "./dev-apns-proxy";
import { developmentNetworkRequestAllowed } from "./dev-network-access";
import { rendererPreviewAlias, rendererWebAlias } from "./renderer-preview-alias";
import { webServiceWorker } from "./service-worker-plugin";
import { readLocalRuntimeVars } from "./src/server/runtime-env";

export default defineConfig(({ command }) => {
  const port = readApiPort(process.env.OPENBOT_API_PORT);
  const localRuntimeVars = command === "serve" ? readLocalRuntimeVars(process.env) : {};
  // The local Worker cannot reach Apple over HTTP/2, so it sends Live Activity updates to this server.
  if (localRuntimeVars.APNS_PRIVATE_KEY) {
    localRuntimeVars.APNS_ORIGIN = `http://127.0.0.1:${port}${DEVELOPMENT_APNS_PATH}`;
  }
  // A local check stands in for the push service of a browser on this computer, over HTTP. A build never
  // sets it, so a deployed Worker sends only to the known push services.
  if (command === "serve") localRuntimeVars.WEB_PUSH_ALLOW_LOOPBACK = "true";
  return {
    resolve: {
      dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"],
      alias: {
        "@openbot/renderer-preview": rendererPreviewAlias,
        "@openbot/renderer-web": rendererWebAlias,
      },
    },
    optimizeDeps: {
      // bloub finds its plush images with `new URL(..., import.meta.url)`. A pre-bundle moves the
      // code away from the images, so Vite serves the package as it is.
      exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
    },
    // Vite removes license comments by default. The home page beam's license requires its notice
    // in each copy, so the minifier moves `/*!` and `@license` comments to the end of each file.
    esbuild: { legalComments: "eof" },
    build: {
      // A caption file has to stay a file. It is small enough for Vite to fold
      // into the bundle as a `data:` URL, and a text track fetched from one is
      // cross-origin to the page that asks for it, so the player drops it and the
      // video plays with no captions at all. Everything else keeps the default.
      assetsInlineLimit: (file) => (file.endsWith(".vtt") ? false : undefined),
    },
    environments: {
      // Worker chunks import each other in cycles. Without strict order, a chunk can run before
      // the chunk that defines its imports, and every request fails with a 500.
      ssr: { build: { rolldownOptions: { output: { strictExecutionOrder: true } } } },
      // Every page runs the modules that the browser entry imports, so they are one file, not about
      // 60 small ones. A phone opens each file as its own request and module. Style sheets keep
      // their own chunks and order.
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [{ name: "start", test: startModule }],
              },
            },
          },
        },
      },
    },
    server: {
      host: readApiHost(process.env.OPENBOT_API_HOST),
      port,
      strictPort: true,
      // `bun run dev:slack` tunnels Slack's install return to this server.
      allowedHosts: [".openbot.localhost", ".trycloudflare.com"],
    },
    plugins: [
      // Empty unless `OPENBOT_BRAND_NAME` is set: the product name of a self-hosted Worker.
      ...brandPlugins(fileURLToPath(new URL("../..", import.meta.url))),
      developmentLanGuard(),
      developmentApnsProxy(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config(config) {
          // `vite dev` runs no relay Worker, so local email leaves from the local socket. The plugin
          // merges arrays from the return value, so the binding must leave the config it passes.
          if (command === "serve") {
            config.services = config.services?.filter((service) => service.binding !== "EMAIL_RELAY");
          }
          return { vars: { ...config.vars, ...localRuntimeVars } };
        },
      }),
      // The Worker keeps every language in its bundle.
      lazyLanguageCatalogs({ applyToEnvironment: (environment) => environment.name === "client" }),
      bloubServerBuild(),
      tanstackStart(),
      solidPlugin({ ssr: true }),
      // Lightning CSS currently reports valid named highlight selectors as
      // unsupported. Let Vite handle the final CSS bundle until that upstream
      // parser false positive is fixed.
      // Before Tailwind: the web client's stylesheet without the desktop-only parts.
      webClientStylesheet(),
      tailwindcss({ optimize: false }),
      tailwindPropertyFallbackRemoval(),
      contentImages(),
      webServiceWorker(),
    ],
  };
});

/**
 * The route tree and the parts of each route that are not split off (`head`, `loader`): the browser
 * entry imports them on every page. Their static imports join the same chunk. A `.lazy.tsx` route
 * loads only when it opens.
 */
function startModule(id: string): boolean {
  if (/\.lazy\.tsx$/.test(id)) return false;
  return /[\\/]apps[\\/]auth-api[\\/]src[\\/](?:router\.tsx|routeTree\.gen\.ts|routes[\\/][^?]*)$/.test(id);
}

function readApiPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3_100;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_API_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}

function developmentLanGuard(): Plugin {
  return {
    name: "openbot-development-lan-guard",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (developmentNetworkRequestAllowed(request.socket.remoteAddress, request.url ?? "/")) {
          next();
          return;
        }
        response.statusCode = 404;
        response.end();
      });
    },
  };
}

const BLOUB_ENTRIES = ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"] as const;

/** The plush build finds each picture with a `new URL()` of `./assets/<file>` on `import.meta.url`. */
const BLOUB_ASSET_URL = /new URL\(`(\.\/assets\/[\w.-]+\.webp)`,\s*import\.meta\.url\)\.href/g;

/**
 * The Cloudflare plugin gives the Worker the `browser` export condition, which selects the DOM
 * build of bloub. That build calls `template()` when it loads, and the Solid server runtime throws
 * there, so every request failed with a 500. The Worker takes the server build of each entry instead.
 *
 * Vite rewrites `new URL(..., import.meta.url)` for the browser only. In the Worker, the plush
 * pictures would point at the module file, not at the site. Each one becomes a `?url` import, which
 * gives the same `/assets/` file that the browser build emits.
 */
function bloubServerBuild(): Plugin {
  const serverEntries = new Map<string, string>(
    BLOUB_ENTRIES.map((entry) => [entry, fileURLToPath(import.meta.resolve(entry))]),
  );
  const serverFiles = new Set(serverEntries.values());
  return {
    name: "openbot-bloub-server-build",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "ssr",
    resolveId(source) {
      return serverEntries.get(source) ?? null;
    },
    transform(code, id) {
      if (!serverFiles.has(id)) return null;
      const imports: string[] = [];
      const rewritten = code.replace(BLOUB_ASSET_URL, (_match, path: string) => {
        const name = `bloubAsset${imports.length}`;
        imports.push(`import ${name} from ${JSON.stringify(`${path}?url`)};`);
        return name;
      });
      return imports.length === 0 ? null : { code: `${imports.join("\n")}\n${rewritten}`, map: null };
    },
  };
}

function readApiHost(value: string | undefined): "127.0.0.1" | "0.0.0.0" {
  if (value === undefined || value.trim() === "") return "127.0.0.1";
  if (value === "127.0.0.1" || value === "0.0.0.0") return value;
  throw new Error("OPENBOT_API_HOST must be 127.0.0.1 or 0.0.0.0.");
}
