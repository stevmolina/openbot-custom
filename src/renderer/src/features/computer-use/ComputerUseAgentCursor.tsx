import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect } from "solid-js";
import { agentCursorPointAt, type CursorMove, type CursorPoint, planAgentCursorMove } from "./agent-cursor-motion";

export interface ComputerUseAgentCursorProps {
  /** Where the tip points, in the overlay's own pixels. */
  x: number;
  y: number;
  /** The agent's name, beside the dart, so two cursors on one desktop say whose each is. */
  label: string;
  /** The agent's colour as `#rrggbb`, or `null` for the accent colour. */
  color: string | null;
}

const translate = (point: CursorPoint) => `${point.x}px ${point.y}px`;

/**
 * The agent cursor OpenBot draws itself.
 *
 * The driver draws one of its own, over the main screen and at the desktop's coordinates inside it,
 * so on a desktop of more than one display it lands as far from the work as that screen's origin is
 * from the desktop's. OpenBot then asks the driver for no cursor and draws this one instead, in the
 * overlay that already covers every display, where one set of coordinates holds everywhere.
 *
 * It is the same dart the OpenBot driver theme draws: a shape no desktop pointer has, because the
 * one thing it has to say is that something other than the user is driving this computer.
 *
 * It travels to each new point with the driver's `adaptive` motion (`agent-cursor-motion.ts`). The
 * inline place is always the point the agent asked for, and the move plays over it, so a cursor
 * that cannot animate still stands on the right point. A new point during a move starts from where
 * the cursor is on screen, not from where it was going.
 *
 * Several agents and threads can work on the desktop at the same time, so each draws its own dart,
 * in its agent's colour, with the agent's name beside it.
 *
 * It is decoration for a screen reader. The rim around the window carries the announcement, and a
 * point that moves with every click would otherwise interrupt the user many times a second.
 */
export function ComputerUseAgentCursor(props: ComputerUseAgentCursorProps) {
  let element: HTMLDivElement | undefined;
  let target: CursorPoint | null = null;
  let playing: { move: CursorMove; animation: Animation } | null = null;

  createEffect(
    () => ({ x: props.x, y: props.y }),
    (next) => {
      // Main sends the placement thirty times a second, most of them with the same point.
      if (target && target.x === next.x && target.y === next.y) return;
      // The animation's own clock, which starts on the first frame it draws, not when it was asked for.
      const from = playing ? agentCursorPointAt(playing.move, Number(playing.animation.currentTime ?? 0)) : target;
      playing?.animation.cancel();
      playing = null;
      target = next;
      // The first point has nowhere to come from, so the cursor appears on it.
      if (!element || !from || !("animate" in element) || prefersReducedMotion()) return;
      const move = planAgentCursorMove(from, next);
      const duration = move[move.length - 1]?.t ?? 0;
      if (duration <= 0) return;
      const animation = element.animate(
        move.map((sample) => ({ translate: translate(sample), offset: sample.t / duration })),
        { duration },
      );
      playing = { move, animation };
      animation.onfinish = () => {
        if (playing?.animation === animation) playing = null;
      };
    },
  );

  return (
    <div
      ref={element}
      class="computer-use-agent-cursor"
      style={{
        translate: translate(props),
        ...(props.color ? { "--computer-use-cursor-color": props.color } : {}),
      }}
      aria-hidden="true"
    >
      <svg class="computer-use-agent-cursor-dart" viewBox="0 0 45 49" aria-hidden="true">
        {/*
         * The dart of the driver theme, corner for corner, with its tip on the origin: the tip is
         * the point the agent asked for, so nothing here is offset from it.
         *
         * The white stroke is drawn under the fill, which is what keeps the shape readable on a dark
         * window and on a light one without a second path.
         */}
        <path d="M0 0 L45 20 L27 31 L14 49 Z" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <span class="computer-use-agent-cursor-label">{props.label}</span>
    </div>
  );
}
