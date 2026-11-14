// Make the web workspace stylesheet lighter. The desktop build does not use this plugin.
//
// `webClientStylesheet` builds the web client's stylesheet (`web-client.css`) from the app stylesheet
// (`styles.css`) without the parts that only the desktop app shows. `web-client.css` imports
// `styles.css`; this step puts the imports of `styles.css` in its place, in their order, and leaves
// out the files in `DESKTOP_ONLY_STYLES`. A file that upstream adds to `styles.css` comes to the web
// client too. A name in `DESKTOP_ONLY_STYLES` that `styles.css` no longer imports stops the build.
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const RENDERER_SOURCE = resolve(import.meta.dirname, "../src/renderer/src");
const APP_STYLESHEET = resolve(RENDERER_SOURCE, "styles.css");
const WEB_CLIENT_STYLESHEET = resolve(RENDERER_SOURCE, "features/web-client/web-client.css");

/**
 * The imports of `styles.css` that the web client never shows. Each one selects only elements of a
 * desktop feature, or only under a root attribute that only the desktop app sets.
 */
export const DESKTOP_ONLY_STYLES: readonly string[] = [
  // The agent dock's edge strip: a desktop window.
  "./features/agent-dock/agent-dock.css",
  // The app update island: the desktop app updates itself; the web client has no update.
  "./features/account/account-update-island.css",
  // The transparent macOS window, under `data-openbot-window-glass` that only the desktop sets.
  "./styles/window-glass.css",
];

/**
 * Styles of screens that open after the first chat. `web-deferred-styles.ts` loads them with that
 * screen. A name that `styles.css` no longer imports stops the build.
 *
 * `@openbot/ui/features/settings/settings-modal.css` stays in the first sheet. The marketplace
 * navigation reuses `.settings-modal-nav-item`, and that rule must stay before the marketplace rule.
 */
export const DEFERRED_WEB_STYLES: readonly string[] = [
  "@openbot/ui/features/billing/billing.css",
  "@openbot/ui/features/tasks/tasks.css",
  "@openbot/ui/features/servers/add-server-dialog.css",
  "@openbot/ui/features/servers/hosted-pricing-page.css",
  "@openbot/ui/features/servers/install-server-dialog.css",
  "@openbot/ui/features/servers/create-local-server-dialog.css",
  "@openbot/ui/features/servers/server-roles.css",
  "@openbot/ui/features/servers/server-audit-log.css",
  "@openbot/ui/features/settings/profile.css",
  "@openbot/ui/features/settings/integration-layout.css",
  "@openbot/ui/features/settings/provider-settings-page.css",
  "@openbot/ui/features/settings/mcp-connect-dialog.css",
  "@openbot/ui/features/settings/notification-matrix.css",
  "@openbot/ui/features/settings/plan-start.css",
  "./features/settings/settings-modal.css",
  "./features/servers/server-settings-modal.css",
  "./features/servers/server-mcp.css",
];

const IMPORT_LINE = /^@import\s+"([^"]+)"\s*;\s*$/;
const SOURCE_LINE = /^@source\s+"([^"]+)"\s*;\s*$/;

/** `styles.css` for `web-client.css`: its imports without `DESKTOP_ONLY_STYLES`, with relative paths. */
export function webAppStyles(appStylesheet: string, webStylesheet: string): string {
  const fromDirectory = dirname(appStylesheet);
  const toDirectory = dirname(webStylesheet);
  const rebase = (path: string) => {
    if (!path.startsWith(".")) return path;
    const rebased = relative(toDirectory, resolve(fromDirectory, path));
    return rebased.startsWith(".") ? rebased : `./${rebased}`;
  };
  const desktopOnly = new Set(DESKTOP_ONLY_STYLES);
  const deferred = new Set(DEFERRED_WEB_STYLES);
  const lines = readFileSync(appStylesheet, "utf8")
    .split("\n")
    .map((line) => {
      const imported = IMPORT_LINE.exec(line.trim())?.[1];
      if (imported !== undefined) {
        if (desktopOnly.delete(imported)) return `/* Desktop only: ${imported} */`;
        if (deferred.delete(imported)) return `/* Loads with the screen: ${imported} */`;
        if (imported === "tailwindcss") return '@import "tailwindcss" source(none);';
        return `@import "${rebase(imported)}";`;
      }
      const source = SOURCE_LINE.exec(line.trim())?.[1];
      if (source !== undefined) return `@source "${rebase(source)}";`;
      return line;
    });
  const missing = [...desktopOnly, ...deferred];
  if (missing.length > 0) {
    throw new Error(`styles.css no longer imports ${missing.join(", ")}. Update scripts/web-stylesheet.ts.`);
  }
  return lines.join("\n");
}

const APP_IMPORT = /^@import\s+"\.\.\/\.\.\/styles\.css"\s*;\s*$/m;

export function webClientStylesheet(): Plugin {
  return {
    name: "openbot:web-client-stylesheet",
    enforce: "pre",
    load: {
      filter: { id: /web-client\.css$/ },
      handler(id) {
        if (resolve(id) !== WEB_CLIENT_STYLESHEET) return null;
        this.addWatchFile(APP_STYLESHEET);
        const source = readFileSync(id, "utf8");
        if (!APP_IMPORT.test(source)) {
          this.warn(`${id} no longer imports ../../styles.css: update scripts/web-stylesheet.ts.`);
          return null;
        }
        return { code: source.replace(APP_IMPORT, () => webAppStyles(APP_STYLESHEET, id)), map: null };
      },
    },
  };
}
