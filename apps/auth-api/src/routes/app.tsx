import { createFileRoute } from "@tanstack/solid-router";
import {
  WEB_APPEARANCE_BOOT_SCRIPT,
  WEB_THEME_COLORS,
} from "../../../../src/renderer/src/features/web-client/web-appearance-boot";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "OpenBot web" },
      { name: "robots", content: "noindex, nofollow" },
      // `viewport-fit=cover` lets the page draw under the notch and the home bar. The web client pads
      // its frame with `env(safe-area-inset-*)`.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      // The boot script below keeps this on the theme that the user picked.
      { name: "theme-color", content: WEB_THEME_COLORS.dark },
      // The installed page opens without the browser bar. iOS reads the `apple-` tags and Chrome
      // reads `mobile-web-app-capable`.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "OpenBot" },
    ],
    scripts: [{ children: WEB_APPEARANCE_BOOT_SCRIPT }],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    // Codex live voice of a joined server records in this page. The site's other pages keep `microphone=()`.
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
    // A visual reply page runs in a sandboxed `srcdoc` frame, which inherits this policy. A
    // `script-src` or `default-src` here would stop the page and its bootstrap script.
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
  }),
});
