import type { ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";

/** How long ⌘ (Ctrl elsewhere) stays down alone before the shortcut list shows. */
export const MODIFIER_HOLD_MS = 600;

/** The key that starts every app shortcut: ⌘ on a Mac, Ctrl elsewhere. */
function primaryKey(platform: ShortcutPlatform): "Meta" | "Control" {
  return platform === "mac" ? "Meta" : "Control";
}

function primaryDown(event: KeyboardEvent | MouseEvent, platform: ShortcutPlatform): boolean {
  return platform === "mac" ? event.metaKey : event.ctrlKey;
}

/**
 * Calls `onChange(true)` when the user holds the primary key alone for `MODIFIER_HOLD_MS`, and
 * `onChange(false)` when the hold ends. Any other key, a click or a lost focus ends the hold, and the
 * list does not show again until the key goes up: so ⌘K, ⌘Tab and ⌘-click never show it. The
 * listeners run in the capture phase, so a key that another listener stops is seen too. Returns the
 * removal.
 */
export function watchModifierHold(
  target: Window,
  platform: () => ShortcutPlatform | undefined,
  onChange: (held: boolean) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  /** Another key or a click came with this press of the primary key. */
  let blocked = false;

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (shown) {
      shown = false;
      onChange(false);
    }
  };
  const reset = () => {
    blocked = false;
    stop();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const system = platform();
    if (!system) return;
    const alone =
      event.key === primaryKey(system) &&
      !event.altKey &&
      !event.shiftKey &&
      (system === "mac" ? !event.ctrlKey : !event.metaKey);
    if (!alone) {
      blocked = primaryDown(event, system);
      stop();
      return;
    }
    if (blocked || shown || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      shown = true;
      onChange(true);
    }, MODIFIER_HOLD_MS);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const system = platform();
    if (!system) return;
    if (event.key === primaryKey(system) || !primaryDown(event, system)) reset();
  };
  const onPointerDown = (event: MouseEvent) => {
    const system = platform();
    blocked = system !== undefined && primaryDown(event, system);
    stop();
  };
  const onVisibility = () => reset();

  const options = { capture: true } as const;
  target.addEventListener("keydown", onKeyDown, options);
  target.addEventListener("keyup", onKeyUp, options);
  target.addEventListener("pointerdown", onPointerDown, options);
  target.addEventListener("mousedown", onPointerDown, options);
  target.addEventListener("wheel", onPointerDown, { capture: true, passive: true });
  target.addEventListener("blur", reset);
  target.document.addEventListener("visibilitychange", onVisibility);
  return () => {
    reset();
    target.removeEventListener("keydown", onKeyDown, options);
    target.removeEventListener("keyup", onKeyUp, options);
    target.removeEventListener("pointerdown", onPointerDown, options);
    target.removeEventListener("mousedown", onPointerDown, options);
    target.removeEventListener("wheel", onPointerDown, options);
    target.removeEventListener("blur", reset);
    target.document.removeEventListener("visibilitychange", onVisibility);
  };
}
