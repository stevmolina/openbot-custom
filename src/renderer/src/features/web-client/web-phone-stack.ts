/**
 * The back swipe of a phone, as on iOS: a drag from the leading edge of a pushed chat moves the chat
 * with the finger and shows the list under it. Past about a third of the width, or with a fast flick,
 * the chat goes back to the list; else it springs back.
 *
 * The frame carries the state for the stylesheet: `data-web-phone-swiping` while the finger moves the
 * chat, and `--web-phone-swipe` from 0 (the chat covers the list) to 1 (the list shows). When the
 * finger lifts, both go, and the transitions of the stylesheet finish the motion from where it stopped.
 */

/** The share of the width past which a slow release goes back. */
const COMMIT_PROGRESS = 0.35;
/** A release faster than this, in pixels per millisecond toward the end, goes back at any distance. */
const COMMIT_VELOCITY = 0.5;
/** The movement in pixels that decides between a back swipe and a scroll. */
const SLOP = 8;
/** The pointer samples of the last part of the drag give the release speed. */
const VELOCITY_WINDOW_MS = 80;

export const WEB_PHONE_SWIPE_ATTRIBUTE = "data-web-phone-swiping";
const SWIPE_PROPERTY = "--web-phone-swipe";

interface Sample {
  x: number;
  time: number;
}

/**
 * Follows one pointer from the edge. `onCommit` shows the list; the caller then applies the new pane
 * at once (`flush`), so the stylesheet animates from the finger's place to the end.
 */
export function trackPhoneSwipeBack(event: PointerEvent, frame: HTMLElement, onCommit: () => void): void {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  const edge = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!edge) return;
  const rtl = getComputedStyle(frame).direction === "rtl";
  const width = frame.getBoundingClientRect().width || 1;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  let swiping = false;
  let samples: Sample[] = [{ x: startX, time: event.timeStamp }];
  edge.setPointerCapture(pointerId);

  const distance = (clientX: number) => (rtl ? startX - clientX : clientX - startX);
  const progressAt = (clientX: number) => Math.min(1, Math.max(0, distance(clientX) / width));

  function move(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = distance(moveEvent.clientX);
    const dy = moveEvent.clientY - startY;
    if (!swiping) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        finish();
        return;
      }
      if (dx < SLOP) return;
      swiping = true;
      frame.setAttribute(WEB_PHONE_SWIPE_ATTRIBUTE, "");
    }
    moveEvent.preventDefault();
    samples = [...samples, { x: moveEvent.clientX, time: moveEvent.timeStamp }].filter(
      (sample) => moveEvent.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
    );
    frame.style.setProperty(SWIPE_PROPERTY, String(progressAt(moveEvent.clientX)));
  }

  function release(upEvent: PointerEvent) {
    if (upEvent.pointerId !== pointerId) return;
    if (swiping) {
      const first = samples[0];
      const elapsed = first ? upEvent.timeStamp - first.time : 0;
      const velocity = first && elapsed > 0 ? (distance(upEvent.clientX) - distance(first.x)) / elapsed : 0;
      const commit = progressAt(upEvent.clientX) > COMMIT_PROGRESS || velocity > COMMIT_VELOCITY;
      if (commit) onCommit();
    }
    finish();
  }

  function finish() {
    edge?.removeEventListener("pointermove", move);
    edge?.removeEventListener("pointerup", release);
    edge?.removeEventListener("pointercancel", cancel);
    if (edge?.hasPointerCapture(pointerId)) edge.releasePointerCapture(pointerId);
    frame.removeAttribute(WEB_PHONE_SWIPE_ATTRIBUTE);
    frame.style.removeProperty(SWIPE_PROPERTY);
  }

  function cancel(cancelEvent: PointerEvent) {
    if (cancelEvent.pointerId === pointerId) finish();
  }

  edge.addEventListener("pointermove", move);
  edge.addEventListener("pointerup", release);
  edge.addEventListener("pointercancel", cancel);
}
