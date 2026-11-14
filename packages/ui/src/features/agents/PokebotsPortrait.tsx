import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { PokebotsPortrait as Portrait } from "@openbot/brand/pokebots-avatar";
import { Show } from "solid-js";
import { POKEBOTS_PORTRAIT_IMAGES } from "./pokebots-portraits";

/** Bundled landing art with the agent's live state. SVG geometry belongs to this artwork. */
export function PokebotsPortrait(props: { portrait: Portrait; mood: AvatarMood; animate: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      class="bloub-avatar-svg pokebots-portrait"
      data-mood={props.mood}
      data-animate={props.animate ? "true" : undefined}
      aria-hidden="true"
    >
      <image href={POKEBOTS_PORTRAIT_IMAGES[props.portrait]} width="100" height="100" />
      {/* These marks carry the state of the agent. They are part of the avatar artwork. */}
      <Show when={props.mood === "working" || props.mood === "connecting"}>
        <g class="pokebots-portrait-dots" fill="var(--openbot-text-primary)">
          <circle cx="75" cy="24" r="3" />
          <circle cx="84" cy="24" r="3" />
          <circle cx="93" cy="24" r="3" />
        </g>
      </Show>
      <Show when={props.mood === "waiting"}>
        <circle cx="87" cy="24" r="5" fill="var(--openbot-accent)" />
      </Show>
      <Show when={props.mood === "failed"}>
        <path d="M83 18l10 10m0-10L83 28" class="pokebots-portrait-mark" />
      </Show>
      <Show when={props.mood === "asleep"}>
        <path d="M79 20h9l-9 9h9m1-23h7l-7 7h7" class="pokebots-portrait-mark" />
      </Show>
      <Show when={props.mood === "responded"}>
        <path d="M80 23l5 5 10-12" class="pokebots-portrait-mark" />
      </Show>
    </svg>
  );
}
