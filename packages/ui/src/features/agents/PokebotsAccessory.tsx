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
 * It sits in the same grid cell as the plush and in the same frame, so every surface that sizes the
 * avatar sizes it too. `pokebots-avatar.css` hides it where faces are too small to show it.
 */
export function PokebotsAccessory(props: { seed: string; shape: ShapeId; color: string }) {
  const parts = createMemo(() => pokebotsAccessoryParts(pokebotsAccessory(props.seed), props.shape, props.color));
  return (
    <svg
      viewBox={POKEBOTS_ACCESSORY_VIEW_BOX}
      width="100"
      height="100"
      class="pokebots-accessory-svg"
      style={ACCESSORY_STYLE}
      aria-hidden="true"
    >
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
  );
}

const ACCESSORY_STYLE = {
  "grid-area": "1 / 1",
  "pointer-events": "none",
  transform: `scale(${POKEBOTS_ACCESSORY_SCALE})`,
} as const;
