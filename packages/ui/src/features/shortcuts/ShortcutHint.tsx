import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { Kbd } from "../../surface";
import { type ShortcutId, type ShortcutPlatform, shortcutKeys } from "./shortcut-registry";

/** The key caps of one chord, such as `⌘` `K`. */
export function ShortcutKeys(props: { keys: readonly string[]; class?: string }): JSX.Element {
  return (
    <span class={props.class ? `shortcut-keys ${props.class}` : "shortcut-keys"} aria-hidden="true">
      <For each={props.keys}>{(key) => <Kbd>{key}</Kbd>}</For>
    </span>
  );
}

/**
 * A control's name with its shortcut beside it, for a tooltip. Without a platform, as before main
 * reports the system, it shows the name alone.
 */
export function ShortcutLabel(props: {
  label: string;
  shortcut: ShortcutId;
  platform: ShortcutPlatform | undefined;
}): JSX.Element {
  const keys = () => (props.platform ? shortcutKeys(props.shortcut, props.platform)[0] : undefined);
  return (
    <span class="shortcut-label">
      <span>{props.label}</span>
      <Show when={keys()}>{(chord) => <ShortcutKeys keys={chord()} />}</Show>
    </span>
  );
}
