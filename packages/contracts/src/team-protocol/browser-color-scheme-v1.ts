// Frozen optional browser-color-scheme-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member sets the
// color scheme that a host browser tab that the member can see gives to its page (`prefers-color-scheme`).
// `system` removes the override. The answer is empty; the tab list already carries the scheme of each
// tab in its `environment`, and the host sends `browser-changed` after the change. Bounds and meaning
// do not follow IPC changes; widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const BROWSER_COLOR_SCHEME_CAPABILITY = "browser-color-scheme-v1";
export const BROWSER_COLOR_SCHEME_ROUTES = {
  set: "/v1/browser/color-scheme",
} as const;

export const BROWSER_COLOR_SCHEMES = ["light", "dark", "system"] as const;
export type BrowserColorScheme = (typeof BROWSER_COLOR_SCHEMES)[number];

const setRequest = fields({ tabId: identifier, colorScheme: oneOf(...BROWSER_COLOR_SCHEMES) });

export const BROWSER_COLOR_SCHEME_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BROWSER_COLOR_SCHEME_ROUTES.set, adminRoute(setRequest, empty)],
]);
