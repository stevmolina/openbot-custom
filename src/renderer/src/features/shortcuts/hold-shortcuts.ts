import type { ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";

/** Observe keys without taking them from the app, native menu, or focused control. */
export function installHoldShortcuts(
  target: Window,
  platform: () => ShortcutPlatform | undefined,
  show: (visible: boolean) => void,
): () => void {
  const pressed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointerHeld = false;

  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    show(false);
  };
  const reset = () => {
    hide();
    pressed.clear();
    pointerHeld = false;
  };
  const keyDown = (event: KeyboardEvent) => {
    const system = platform();
    pressed.add(event.code || event.key);
    const alone =
      system !== undefined &&
      event.key === (system === "mac" ? "Meta" : "Control") &&
      (system === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      !event.isComposing &&
      pressed.size === 1 &&
      !pointerHeld;
    if (!alone) {
      hide();
      return;
    }
    // Only a fresh press starts the timer. Releasing another key never starts it again.
    if (event.repeat || timer !== undefined) return;
    timer = setTimeout(() => {
      if (target.document.visibilityState === "visible" && target.document.hasFocus()) show(true);
    }, 600);
  };
  const keyUp = (event: KeyboardEvent) => {
    pressed.delete(event.code || event.key);
    hide();
    // macOS can omit other keyup events while Command is down.
    if (event.key === "Meta" && !event.metaKey) pressed.clear();
  };
  const pointerDown = () => {
    pointerHeld = true;
    hide();
  };
  const pointerUp = () => {
    pointerHeld = false;
  };

  target.addEventListener("keydown", keyDown, true);
  target.addEventListener("keyup", keyUp, true);
  target.addEventListener("pointerdown", pointerDown, true);
  target.addEventListener("mousedown", pointerDown, true);
  target.addEventListener("pointerup", pointerUp, true);
  target.addEventListener("mouseup", pointerUp, true);
  target.addEventListener("pointercancel", pointerUp, true);
  target.addEventListener("blur", reset);
  target.document.addEventListener("visibilitychange", reset);
  return () => {
    reset();
    target.removeEventListener("keydown", keyDown, true);
    target.removeEventListener("keyup", keyUp, true);
    target.removeEventListener("pointerdown", pointerDown, true);
    target.removeEventListener("mousedown", pointerDown, true);
    target.removeEventListener("pointerup", pointerUp, true);
    target.removeEventListener("mouseup", pointerUp, true);
    target.removeEventListener("pointercancel", pointerUp, true);
    target.removeEventListener("blur", reset);
    target.document.removeEventListener("visibilitychange", reset);
  };
}
