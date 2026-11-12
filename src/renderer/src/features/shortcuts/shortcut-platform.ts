import type { ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";
import { currentDevicePlatform } from "../../send-shortcut-preference";

/** The keyboard of the device: the app's report on desktop, the browser's guess in the web client. */
export function shortcutPlatform(appPlatform?: "darwin" | "win32" | "linux"): ShortcutPlatform {
  return (appPlatform ?? currentDevicePlatform()) === "darwin" ? "mac" : "pc";
}
