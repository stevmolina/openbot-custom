/**
 * Keeps the web app on the part of the screen that the user sees.
 *
 * iOS and iPadOS do not resize the page when the keyboard opens: the keyboard covers the bottom of
 * the page, and Safari moves the page to show the focused field. The viewport units also do not
 * always reach the bottom edge, so a page sized with `100dvh` can stop above the home indicator.
 * The visual viewport is the part that shows. The app follows it:
 * - The inline `top` and `height` of the app root place it over the visual viewport.
 * - `data-web-keyboard-open` says that a keyboard covers the bottom, so the stylesheet removes the
 *   room for the home indicator, which the keyboard covers.
 *
 * Safari sends `resize` and `scroll` many times while the keyboard opens and while the user types or
 * pans. The code writes only the values that changed, and it writes `top` and `height`, not custom
 * properties. A custom property on the root inherits, so each new value restyled every element of
 * the app (about 70 ms on an iPad layout); a new `height` restyles only the root.
 *
 * While the user zooms with two fingers, the app does not follow, so the zoom works as usual.
 */

export const WEB_KEYBOARD_OPEN_ATTRIBUTE = "data-web-keyboard-open";

/** A visual viewport this much shorter than the layout viewport has a keyboard under it. */
const KEYBOARD_MIN_HEIGHT = 120;
/** Zoom levels this close to 1 are not a pinch zoom. */
const SCALE_TOLERANCE = 0.01;

export function trackVisualViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  let height = "";
  let top = "";
  let keyboardOpen = false;

  function write(nextHeight: string, nextTop: string, nextKeyboardOpen: boolean) {
    if (nextHeight !== height) {
      height = nextHeight;
      element.style.height = height;
    }
    if (nextTop !== top) {
      top = nextTop;
      element.style.top = top;
    }
    if (nextKeyboardOpen !== keyboardOpen) {
      keyboardOpen = nextKeyboardOpen;
      element.toggleAttribute(WEB_KEYBOARD_OPEN_ATTRIBUTE, keyboardOpen);
    }
  }

  /** The stylesheet places the app over the layout viewport again. */
  function clear() {
    write("", "", false);
  }

  function apply() {
    frame = 0;
    if (!viewport || Math.abs(viewport.scale - 1) > SCALE_TOLERANCE) {
      clear();
      return;
    }
    const layoutHeight = document.documentElement.clientHeight;
    write(`${viewport.height}px`, `${viewport.offsetTop}px`, layoutHeight - viewport.height > KEYBOARD_MIN_HEIGHT);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(apply);
  }

  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  apply();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    clear();
  };
}
