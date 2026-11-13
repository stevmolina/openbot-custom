/**
 * Keeps the web app on the part of the screen that the user sees.
 *
 * iOS and iPadOS do not resize the page when the keyboard opens: the keyboard covers the bottom of
 * the page, and Safari moves the page to show the focused field. The viewport units also do not
 * always reach the bottom edge, so a page sized with `100dvh` can stop above the home indicator.
 * The visual viewport is the part that shows. The app follows it:
 * - `--web-visual-height` and `--web-visual-top` place the app over the visual viewport.
 * - `data-web-keyboard-open` says that a keyboard covers the bottom, so the stylesheet removes the
 *   room for the home indicator, which the keyboard covers.
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

  function clear() {
    element.style.removeProperty("--web-visual-height");
    element.style.removeProperty("--web-visual-top");
    element.removeAttribute(WEB_KEYBOARD_OPEN_ATTRIBUTE);
  }

  function apply() {
    frame = 0;
    if (!viewport || Math.abs(viewport.scale - 1) > SCALE_TOLERANCE) {
      clear();
      return;
    }
    const layoutHeight = document.documentElement.clientHeight;
    element.style.setProperty("--web-visual-height", `${viewport.height}px`);
    element.style.setProperty("--web-visual-top", `${viewport.offsetTop}px`);
    element.toggleAttribute(WEB_KEYBOARD_OPEN_ATTRIBUTE, layoutHeight - viewport.height > KEYBOARD_MIN_HEIGHT);
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
