// Removes the `@property` fallback that Tailwind CSS v4 adds to each stylesheet.
//
// Tailwind registers its `--tw-*` variables with `@property`. For browsers without `@property`, it
// also adds this block, which gives every element and its `::before`, `::after` and `::backdrop`
// about 50 `--tw-*: initial` declarations:
//
//   @layer properties {
//     @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or (...) {
//       *, ::before, ::after, ::backdrop { --tw-rotate-x: initial; ... }
//     }
//   }
//
// Tailwind 4.3.3 finds Safari before 16.4 by the absence of `margin-trim: inline` (4.3.5 tests
// `margin-trim: block`). Newer WebKit builds (Playwright WebKit 27, Safari Technology Preview) do not
// parse `margin-trim: inline`, so the block applies there too. A rule that matches every element then makes each style change on a high
// element slower: on the web client's iPad layout, a change of one custom property on the app root
// took 61 ms with the block and 36 ms without it.
//
// Every browser that Tailwind CSS v4 supports (Safari 16.4, Chrome 111, Firefox 128 and newer) has
// `@property`, so the registered initial values apply without the block, and the styles do not change.
// Tailwind has a `polyfills` compile option, but `@tailwindcss/vite` does not pass one on.
//
// The plugin runs after `@tailwindcss/vite` (put it after `tailwindcss()` in the plugin list) and
// before Vite's own CSS step, on the Tailwind output of each stylesheet. If a Tailwind update writes
// the block in another shape, the plugin keeps the stylesheet and warns, so the build log shows it.
import type { Plugin } from "vite";

/** The start of the fallback's `@supports` rule, for any `margin-trim` value that Tailwind tests. */
const FALLBACK_START = /@supports\s*\(\(-webkit-hyphens:\s*none\)\s*and\s*\(not\s*\(margin-trim:\s*[\w-]+\)\)\)/;
const PROPERTIES_LAYER = /@layer properties\s*\{\s*\}/g;

/** The index after the block that opens at `open` (a `{`), with strings and comments skipped. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    const char = css[index];
    if (char === '"' || char === "'") {
      index = css.indexOf(char, index + 1);
      if (index < 0) return -1;
    } else if (char === "/" && css[index + 1] === "*") {
      index = css.indexOf("*/", index + 2) + 1;
      if (index <= 0) return -1;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** The stylesheet without Tailwind's `@property` fallback, or `undefined` when it has none. */
export function removeTailwindPropertyFallback(css: string): string | undefined {
  let result = css;
  let match = FALLBACK_START.exec(result);
  if (!match) return undefined;
  while (match) {
    const open = result.indexOf("{", match.index + match[0].length);
    const end = open < 0 ? -1 : blockEnd(result, open);
    // An unexpected shape keeps the stylesheet as Tailwind wrote it.
    if (end < 0) return undefined;
    result = result.slice(0, match.index) + result.slice(end);
    match = FALLBACK_START.exec(result);
  }
  return result.replace(PROPERTIES_LAYER, "");
}

/** Tailwind output that still has a fallback block, in a shape that this file does not know. */
function keepsFallback(css: string): boolean {
  return /@layer properties\s*\{/.test(css) && css.includes("-webkit-hyphens");
}

export function tailwindPropertyFallbackRemoval(): Plugin {
  return {
    name: "openbot:tailwind-property-fallback",
    enforce: "pre",
    transform: {
      filter: { id: /\.css(?:\?.*)?$/ },
      handler(code, id) {
        const css = removeTailwindPropertyFallback(code);
        if (keepsFallback(css ?? code)) {
          this.warn(`${id} keeps Tailwind's @property fallback: update scripts/tailwind-property-fallback.ts.`);
        }
        return css === undefined ? null : { code: css, map: null };
      },
    },
  };
}
