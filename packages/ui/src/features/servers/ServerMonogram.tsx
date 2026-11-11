/**
 * The mark of a server that has no logo: a dark tile with a light round shape, and on it the first
 * letter of the server name. The server of this computer shows a laptop in place of the letter.
 *
 * The drawing is an SVG on a 40 by 40 grid, so it keeps its shape at every size, from the 14px mark
 * at the end of a chat row to the 40px rail button. Its colors are the paper tokens, which do not
 * change with the theme, so a server looks the same in light and dark. The letter size is in units
 * of that grid, so it is an attribute of the drawing, not a text size of the page.
 */

import { Show } from "solid-js";

export interface ServerMonogramProps {
  /** The server name. Without one, the tile shows the round shape alone. */
  name?: string | undefined;
  /** The server runs on this computer: the tile shows a laptop. */
  thisComputer?: boolean | undefined;
}

/** The first letter of the name, upper case. A name that starts with no letter or digit gives none. */
export function serverMonogramLetter(name: string | undefined): string {
  const match = name?.trim().match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase() : "";
}

export function ServerMonogram(props: ServerMonogramProps) {
  const letter = () => serverMonogramLetter(props.name);
  return (
    <span class="ui-server-gradient-logo ui-server-monogram" aria-hidden="true">
      <svg viewBox="0 0 40 40" class="ui-server-monogram-art" aria-hidden="true">
        <circle class="ui-server-monogram-shape" cx="23.5" cy="25.5" r="24" />
        <Show
          when={props.thisComputer}
          fallback={
            <Show when={letter()}>
              {(text) => (
                <text class="ui-server-monogram-letter" x="21.5" y="24" font-size="25" transform="rotate(-8 21.5 24)">
                  {text()}
                </text>
              )}
            </Show>
          }
        >
          <g class="ui-server-monogram-laptop" transform="rotate(-8 21.5 24)">
            <rect x="12" y="14" width="19" height="13" rx="2.4" />
            <path d="M8.5 31h26" />
          </g>
        </Show>
      </svg>
    </span>
  );
}

/**
 * The mark of the "All machines" view: four tiles in a grid, in the colors of the server monogram, as
 * a sign for "every server". It reads at 14px, where small server logos would not.
 */
export function AllMachinesMonogram() {
  return (
    <span class="ui-server-gradient-logo ui-server-monogram" aria-hidden="true">
      <svg viewBox="0 0 40 40" class="ui-server-monogram-art" aria-hidden="true">
        <g class="ui-server-monogram-tiles" transform="rotate(-8 20 20)">
          <rect x="8" y="8" width="11" height="11" rx="3.5" />
          <rect x="21" y="8" width="11" height="11" rx="5.5" />
          <rect x="8" y="21" width="11" height="11" rx="5.5" />
          <rect x="21" y="21" width="11" height="11" rx="3.5" />
        </g>
      </svg>
    </span>
  );
}
