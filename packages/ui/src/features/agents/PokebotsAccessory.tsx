import type { ShapeId } from "@norbert_bodziony/bloub";
import {
  POKEBOTS_ACCESSORY_SCALE,
  POKEBOTS_ACCESSORY_VIEW_BOX,
  pokebotsAccessory,
  pokebotsAccessoryParts,
} from "@openbot/brand/pokebots-avatar";
import { createMemo, For } from "solid-js";

/**
 * The felt accessory that a generated Pokebots face wears: headphones, a sprout, a scarf and others.
 * It covers the avatar box and draws its picture as the plush draws its own: 128% of the box, centred,
 * in the same frame and with the same optical offset. It is not a child `svg` of the avatar, so the
 * surface rules for `.agent-avatar > svg` and the display of the avatar (grid, block or inline) do not
 * move it. `pokebots-avatar.css` positions the avatar and hides the accessory where faces are too
 * small to show it.
 */
export function PokebotsAccessory(props: { seed: string; shape: ShapeId; color: string }) {
  const parts = createMemo(() => pokebotsAccessoryParts(pokebotsAccessory(props.seed), props.shape, props.color));
  return (
    <span class="pokebots-accessory" style={LAYER_STYLE} aria-hidden="true">
      <svg viewBox={POKEBOTS_ACCESSORY_VIEW_BOX} style={DRAWING_STYLE} aria-hidden="true">
        <For each={parts()}>
          {(part) => (
            <path
              d={part.d}
              fill={part.fill ?? "none"}
              stroke={part.stroke}
              stroke-width={part.strokeWidth}
              stroke-dasharray={part.dash}
              stroke-linecap="round"
              stroke-linejoin="round"
              opacity={part.opacity}
            />
          )}
        </For>
      </svg>
    </span>
  );
}

const LAYER_STYLE = {
  position: "absolute",
  inset: "0",
  "pointer-events": "none",
  translate: "var(--agent-avatar-optical-offset-x, 0) var(--agent-avatar-optical-offset, 0)",
} as const;

const DRAWING_STYLE = {
  position: "absolute",
  left: "-14%",
  top: "-14%",
  width: "128%",
  height: "128%",
  overflow: "visible",
  transform: `scale(${POKEBOTS_ACCESSORY_SCALE})`,
} as const;
