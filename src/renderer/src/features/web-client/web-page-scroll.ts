/**
 * The workspace is a fixed app shell: its lists scroll inside it, and the page itself never scrolls.
 *
 * iOS and iPadOS Safari move the whole page up when a text field near the bottom takes focus, so the
 * field stays above the keyboard (or the shortcut bar of a hardware keyboard). When the keyboard
 * closes, Safari often leaves the page there: the top of the app is under the browser toolbar and an
 * empty band shows under the app. This module moves the page back to the top when no text field has
 * focus. While a field has focus, it does nothing, so the field stays above the keyboard.
 */

const TEXT_INPUT_EXCLUDED = new Set(["checkbox", "radio", "range", "color", "button", "submit", "reset", "file"]);

function textFieldHasFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    return true;
  }
  return active instanceof HTMLInputElement && !TEXT_INPUT_EXCLUDED.has(active.type);
}

/** Installs the listeners on the window. Returns the cleanup. */
export function installWebPageScrollReset(): () => void {
  let frame = 0;

  function settle() {
    frame = 0;
    if (textFieldHasFocus()) return;
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  }

  // Focus moves after `focusout`, and Safari ends its keyboard scroll after the viewport resize, so
  // the check waits one frame.
  function schedule() {
    if (frame === 0) frame = requestAnimationFrame(settle);
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("focusout", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  schedule();
  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("focusout", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
  };
}
