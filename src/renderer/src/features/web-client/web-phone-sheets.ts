/**
 * On a phone, the stylesheet presents each dialog as a bottom sheet with a grabber, as the iOS app's
 * form sheets. This module lets the user drag the sheet down by its top edge: past a quarter of its
 * height, or with a fast flick, it slides out and closes; else it springs back.
 *
 * The close goes through Escape, so a dialog that keeps itself open on Escape (unsaved work) also
 * stays open here and springs back.
 */

const PHONE_QUERY = "(max-width: 720px)";
/** The band at the top of the sheet that starts a drag: the grabber and the header row under it. */
const GRAB_BAND = 44;
const SLOP = 6;
const DISMISS_PROGRESS = 0.25;
/** Pixels per millisecond downward. */
const DISMISS_VELOCITY = 0.6;
const VELOCITY_WINDOW_MS = 80;
const SHEET_SELECTOR = ".ui-dialog-content:not([data-dialog-surface='unstyled'])";
const DRAGGING_ATTRIBUTE = "data-web-phone-sheet-dragging";
const SPRING_BACK = "transform var(--openbot-duration-overlay) cubic-bezier(0.32, 0.72, 0, 1)";
const LEAVING_ATTRIBUTE = "data-web-phone-sheet-leaving";

interface Drag {
  sheet: HTMLElement;
  startY: number;
  height: number;
  moved: boolean;
  samples: { y: number; time: number }[];
}

function sheetAt(target: EventTarget | null, clientY: number): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const sheet = target.closest<HTMLElement>(SHEET_SELECTOR);
  if (!sheet || sheet.hasAttribute(LEAVING_ATTRIBUTE)) return null;
  return clientY - sheet.getBoundingClientRect().top <= GRAB_BAND ? sheet : null;
}

/** Installs the drag on the document. Returns the cleanup. */
export function installWebPhoneSheets(): () => void {
  const query = window.matchMedia?.(PHONE_QUERY);
  let drag: Drag | null = null;
  let suppressClick = false;

  function start(target: EventTarget | null, clientY: number, time: number) {
    if (!query?.matches || drag) return;
    const sheet = sheetAt(target, clientY);
    if (!sheet) return;
    drag = {
      sheet,
      startY: clientY,
      height: sheet.getBoundingClientRect().height || 1,
      moved: false,
      samples: [{ y: clientY, time }],
    };
  }

  /** True when the drag took the movement, so the page must not scroll. */
  function move(clientY: number, time: number): boolean {
    if (!drag) return false;
    const dy = clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < SLOP) return false;
      if (dy < 0) {
        drag = null;
        return false;
      }
      drag.moved = true;
      drag.sheet.setAttribute(DRAGGING_ATTRIBUTE, "");
      drag.sheet.style.transition = "none";
    }
    drag.samples = [...drag.samples, { y: clientY, time }].filter((sample) => time - sample.time <= VELOCITY_WINDOW_MS);
    // Up past the rest place, the sheet moves a tenth of the finger's way, as a native sheet resists.
    const offset = dy >= 0 ? dy : dy / 10;
    drag.sheet.style.transform = `translateY(${offset}px)`;
    return true;
  }

  function end(clientY: number, time: number) {
    const current = drag;
    drag = null;
    if (!current?.moved) return;
    suppressClick = true;
    const { sheet } = current;
    const first = current.samples[0];
    const elapsed = first ? time - first.time : 0;
    const velocity = first && elapsed > 0 ? (clientY - first.y) / elapsed : 0;
    const dy = clientY - current.startY;
    sheet.removeAttribute(DRAGGING_ATTRIBUTE);
    if (dy / current.height < DISMISS_PROGRESS && velocity < DISMISS_VELOCITY) {
      // Back to the rest place with the curve of the iOS sheet.
      sheet.style.transition = SPRING_BACK;
      sheet.style.transform = "";
      const settled = (event: TransitionEvent) => {
        if (event.target !== sheet) return;
        sheet.removeEventListener("transitionend", settled);
        sheet.style.removeProperty("transition");
      };
      sheet.addEventListener("transitionend", settled);
      return;
    }
    sheet.style.removeProperty("transition");
    sheet.style.transform = "";
    // The sheet slides out from the finger's place, then the dialog closes as on Escape.
    sheet.style.setProperty("--web-phone-sheet-from", `${Math.max(0, dy)}px`);
    sheet.setAttribute(LEAVING_ATTRIBUTE, "");
    // The children's animations bubble here too; only the sheet's own end closes it.
    const left = (event: AnimationEvent) => {
      if (event.target !== sheet) return;
      sheet.removeEventListener("animationend", left);
      sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      // A dialog that stays open on Escape comes back.
      requestAnimationFrame(() => {
        if (sheet.isConnected && !sheet.hasAttribute("data-closed")) {
          sheet.removeAttribute(LEAVING_ATTRIBUTE);
          sheet.style.removeProperty("--web-phone-sheet-from");
        }
      });
    };
    sheet.addEventListener("animationend", left);
  }

  const pointerDown = (event: PointerEvent) => {
    // Touch goes through the touch events, whose move can stop the page from scrolling.
    if (event.pointerType === "touch" || event.button !== 0) return;
    start(event.target, event.clientY, event.timeStamp);
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && move(event.clientY, event.timeStamp)) event.preventDefault();
  };
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch") end(event.clientY, event.timeStamp);
  };
  const touchStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    if (touch) start(event.target, touch.clientY, event.timeStamp);
  };
  const touchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch && move(touch.clientY, event.timeStamp)) event.preventDefault();
  };
  const touchEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (touch) end(touch.clientY, event.timeStamp);
  };
  // A drag that started on a button of the header does not also press it.
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const clearClick = () => {
    suppressClick = false;
  };

  document.addEventListener("pointerdown", pointerDown, true);
  document.addEventListener("pointermove", pointerMove, true);
  document.addEventListener("pointerup", pointerUp, true);
  document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", touchMove, { capture: true, passive: false });
  document.addEventListener("touchend", touchEnd, true);
  document.addEventListener("touchcancel", touchEnd, true);
  document.addEventListener("click", click, true);
  // A click that the drag swallowed comes right after its release; a later press is a new one.
  document.addEventListener("pointerdown", clearClick);
  return () => {
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("pointermove", pointerMove, true);
    document.removeEventListener("pointerup", pointerUp, true);
    document.removeEventListener("touchstart", touchStart, true);
    document.removeEventListener("touchmove", touchMove, true);
    document.removeEventListener("touchend", touchEnd, true);
    document.removeEventListener("touchcancel", touchEnd, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("pointerdown", clearClick);
  };
}
