// Two build steps that make the stylesheets of the account service lighter on phones. The desktop app
// does not use them (`electron.vite.config.ts`), so its styles do not change.
//
// `webClientStylesheet` builds the web client's stylesheet (`web-client.css`) from the app stylesheet
// (`styles.css`) without the parts that only the desktop app shows. `web-client.css` imports
// `styles.css`; this step puts the imports of `styles.css` in its place, in their order, and leaves
// out the files in `DESKTOP_ONLY_STYLES`. A file that upstream adds to `styles.css` comes to the web
// client too. A name in `DESKTOP_ONLY_STYLES` that `styles.css` no longer imports stops the build.
//
// `scopedPseudoElementReset` changes one rule of Tailwind's preflight. The rule
//
//   *, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; ... }
//
// matches the `::before` and `::after` of every element. WebKit then resolves both pseudo-elements of
// each element at each style change, also when no rule gives them `content`. On the web client's iPad
// layout, that was about a quarter of the time of a change of one custom property on the app root.
// The step takes `::after` and `::before` out of that rule. In its place, a rule in the same layer
// gives the same declarations to each `::before` and `::after` selector of the stylesheet. A
// pseudo-element shows only when a rule of a stylesheet gives it `content`, and that rule's selector
// is in the new rule, so each pseudo-element that shows keeps the same styles.
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const RENDERER_SOURCE = resolve(import.meta.dirname, "../src/renderer/src");
const APP_STYLESHEET = resolve(RENDERER_SOURCE, "styles.css");
const WEB_CLIENT_STYLESHEET = resolve(RENDERER_SOURCE, "features/web-client/web-client.css");

/**
 * The imports of `styles.css` that the web client never shows. Each one selects only elements of a
 * desktop feature, or only under a root attribute that only the desktop app sets.
 */
export const DESKTOP_ONLY_STYLES: readonly string[] = [
  // The agent dock's edge strip: a desktop window.
  "./features/agent-dock/agent-dock.css",
  // The app update island: the desktop app updates itself; the web client has no update.
  "./features/account/account-update-island.css",
  // The transparent macOS window, under `data-openbot-window-glass` that only the desktop sets.
  "./styles/window-glass.css",
];

const IMPORT_LINE = /^@import\s+"([^"]+)"\s*;\s*$/;
const SOURCE_LINE = /^@source\s+"([^"]+)"\s*;\s*$/;

/** `styles.css` for `web-client.css`: its imports without `DESKTOP_ONLY_STYLES`, with relative paths. */
export function webAppStyles(appStylesheet: string, webStylesheet: string): string {
  const fromDirectory = dirname(appStylesheet);
  const toDirectory = dirname(webStylesheet);
  const rebase = (path: string) => {
    if (!path.startsWith(".")) return path;
    const rebased = relative(toDirectory, resolve(fromDirectory, path));
    return rebased.startsWith(".") ? rebased : `./${rebased}`;
  };
  const left = new Set(DESKTOP_ONLY_STYLES);
  const lines = readFileSync(appStylesheet, "utf8")
    .split("\n")
    .map((line) => {
      const imported = IMPORT_LINE.exec(line.trim())?.[1];
      if (imported !== undefined) {
        if (left.delete(imported)) return `/* Desktop only: ${imported} */`;
        return `@import "${rebase(imported)}";`;
      }
      const source = SOURCE_LINE.exec(line.trim())?.[1];
      if (source !== undefined) return `@source "${rebase(source)}";`;
      return line;
    });
  if (left.size > 0) {
    throw new Error(
      `styles.css no longer imports ${[...left].join(", ")}. Update DESKTOP_ONLY_STYLES in scripts/web-stylesheet.ts.`,
    );
  }
  return lines.join("\n");
}

const APP_IMPORT = /^@import\s+"\.\.\/\.\.\/styles\.css"\s*;\s*$/m;

export function webClientStylesheet(): Plugin {
  return {
    name: "openbot:web-client-stylesheet",
    enforce: "pre",
    load: {
      filter: { id: /web-client\.css$/ },
      handler(id) {
        if (resolve(id) !== WEB_CLIENT_STYLESHEET) return null;
        this.addWatchFile(APP_STYLESHEET);
        const source = readFileSync(id, "utf8");
        if (!APP_IMPORT.test(source)) {
          this.warn(`${id} no longer imports ../../styles.css: update scripts/web-stylesheet.ts.`);
          return null;
        }
        return { code: source.replace(APP_IMPORT, () => webAppStyles(APP_STYLESHEET, id)), map: null };
      },
    },
  };
}

// ---------------------------------------------------------------- pseudo-element reset

const RESET_DECLARATIONS = "box-sizing: border-box; margin: 0; padding: 0; border: 0 solid;";
const PREFLIGHT_SELECTORS = ["*", "::after", "::before", "::backdrop", "::file-selector-button"];
const KEEP_IN_PREFLIGHT = "*,\n::backdrop,\n::file-selector-button";
const LAYER_ORDER = "@layer theme, base, components, utilities;";

/** The parts of `list` between commas that are outside parentheses, brackets and strings. */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index++) {
    const char = list.charAt(index);
    if (char === '"' || char === "'") {
      const end = list.indexOf(char, index + 1);
      index = end < 0 ? list.length : end;
    } else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((part) => part !== "");
}

/** The selector without the text in parentheses, brackets and strings. */
function topLevel(selector: string): string {
  let result = "";
  let depth = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector.charAt(index);
    if (char === '"' || char === "'") {
      const end = selector.indexOf(char, index + 1);
      index = end < 0 ? selector.length : end;
    } else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0) result += char;
  }
  return result;
}

const PSEUDO_ELEMENT = /::?(?:before|after)(?![\w-])/i;

/**
 * Pseudo-classes that every browser of the web client reads. A selector with only these goes in one
 * shared rule; a selector with another one gets a rule of its own, so that a browser that cannot read
 * it drops only that rule.
 */
const KNOWN_PSEUDO_CLASSES = new Set([
  "active",
  "after",
  "before",
  "checked",
  "disabled",
  "empty",
  "enabled",
  "first-child",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "hover",
  "is",
  "lang",
  "last-child",
  "last-of-type",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-of-type",
  "only-child",
  "placeholder-shown",
  "root",
  "where",
]);

function knownSelector(selector: string): boolean {
  for (const match of selector.matchAll(/::?(-?[a-z][\w-]*)/gi)) {
    if (!KNOWN_PSEUDO_CLASSES.has((match[1] ?? "").toLowerCase())) return false;
  }
  return true;
}

/**
 * The rules that reset each of `selectors`. They keep each selector as it is: WebKit then files the
 * rule under the selector's last class, tag or attribute, and tests it only on the elements that can
 * match. (A `:where()` around the selector would keep the preflight's specificity, but WebKit then tests
 * the rule on every element, and the change was slower than the preflight.) In Tailwind's base layer
 * only the preflight styles these pseudo-elements, and a rule of a later layer or outside layers wins
 * over the base layer at any specificity, so the higher specificity changes no style.
 */
export function pseudoElementResetRules(selectors: Iterable<string>): string {
  const shared: string[] = [];
  const own: string[] = [];
  for (const selector of new Set(selectors)) (knownSelector(selector) ? shared : own).push(selector);
  const rule = (list: readonly string[]) => `${list.join(",\n")} {\n  ${RESET_DECLARATIONS}\n}\n`;
  return [...(shared.length > 0 ? [rule(shared)] : []), ...own.map((selector) => rule([selector]))].join("");
}

/** A nested selector as a selector of its own, as CSS nesting reads it. */
function unnest(selector: string, parents: readonly string[] | undefined): string {
  if (!parents) return selector;
  const parent = `:is(${parents.join(", ")})`;
  return selector.includes("&") ? selector.replaceAll("&", parent) : `${parent} ${selector}`;
}

interface Block {
  /** The selectors of a style rule, unnested. */
  selectors?: string[];
  /** Its selectors that end in `::before` or `::after`. */
  pseudoSelectors?: string[];
  /** The rule sets a property that makes a pseudo-element show or that the reset changes. */
  sizing?: boolean;
  keyframes?: boolean;
}

/**
 * `content`, which makes a pseudo-element show, and the properties whose result depends on the reset:
 * `box-sizing` changes what a size means, and `border: 0 solid` gives a border width its style.
 */
const SIZING_DECLARATION =
  /^(?:content|box-sizing|border(?:-[\w-]+)?|padding(?:-[\w-]+)?|(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio|flex(?:-basis)?)\s*:/i;

/** Marks the style rule that a declaration belongs to, also through a nested `@media`. */
function markSizing(blocks: readonly Block[]): void {
  const rule = blocks.findLast((block) => block.selectors);
  if (rule) rule.sizing = true;
}

/**
 * The stylesheet with the `::before` and `::after` reset scoped to its pseudo-elements, or `undefined`
 * when it has neither Tailwind's reset nor a rule for a `::before` or `::after` that the reset changes.
 * The reset goes to the selectors of the rules that set `content`, a size, a padding or a border: the
 * reset changes no other pseudo-element. A pseudo-element without `content` does not show. A rule such
 * as the reduced motion rule `*::before { ... }`, which sets only motion, does not make the reset match
 * every element again.
 */
export function scopePseudoElementReset(css: string): string | undefined {
  const pseudoSelectors = new Set<string>();
  // The preflight rule: where its selector starts, where its block opens and where it ends.
  let preflight: { start: number; open: number; end?: number } | undefined;
  const blocks: Block[] = [];
  let preludeStart = 0;
  let prelude = "";
  for (let index = 0; index < css.length; index++) {
    const char = css.charAt(index);
    if (char === '"' || char === "'") {
      const end = css.indexOf(char, index + 1);
      if (end < 0) return undefined;
      prelude += css.slice(index, end + 1);
      index = end;
    } else if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      if (end < 0) return undefined;
      index = end + 1;
    } else if (char === "{") {
      const head = prelude.trim();
      const parent = blocks.at(-1);
      if (head.startsWith("@")) {
        blocks.push({ keyframes: /^@(-\w+-)?keyframes\b/i.test(head) });
      } else if (parent?.keyframes) {
        blocks.push({});
      } else {
        const parents = [...blocks].reverse().find((block) => block.selectors)?.selectors;
        const selectors = splitSelectors(head).map((selector) => unnest(selector, parents));
        const own = splitSelectors(head);
        if (
          !parents &&
          !preflight &&
          own.length === PREFLIGHT_SELECTORS.length &&
          PREFLIGHT_SELECTORS.every((selector) => own.includes(selector))
        ) {
          preflight = { start: preludeStart, open: index };
          blocks.push({ selectors });
        } else {
          const pseudo = selectors.filter((selector) => PSEUDO_ELEMENT.test(topLevel(selector)));
          blocks.push({ selectors, pseudoSelectors: pseudo });
        }
      }
      prelude = "";
      preludeStart = index + 1;
    } else if (char === "}") {
      if (SIZING_DECLARATION.test(prelude.trim())) markSizing(blocks);
      const block = blocks.pop();
      if (block?.sizing) for (const selector of block.pseudoSelectors ?? []) pseudoSelectors.add(selector);
      if (preflight && preflight.end === undefined && index > preflight.open) {
        // The first close after the preflight's own open is its end: the rule has only declarations.
        preflight.end = index + 1;
      }
      prelude = "";
      preludeStart = index + 1;
    } else if (char === ";") {
      if (SIZING_DECLARATION.test(prelude.trim())) markSizing(blocks);
      prelude = "";
      preludeStart = index + 1;
    } else {
      if (prelude === "" && /\s/.test(char)) preludeStart = index + 1;
      prelude += char;
    }
  }
  if (blocks.length !== 0) return undefined;
  if (!preflight && pseudoSelectors.size === 0) return undefined;
  const reset = `\n${pseudoElementResetRules(pseudoSelectors)}`;
  if (preflight?.end !== undefined) {
    const declarations = css.slice(preflight.open, preflight.end);
    return `${css.slice(0, preflight.start)}${KEEP_IN_PREFLIGHT} ${declarations}${reset}${css.slice(preflight.end)}`;
  }
  // No preflight here: the page has it from another stylesheet. The rule joins Tailwind's base layer.
  return `${css}\n${LAYER_ORDER}\n@layer base {${reset}}\n`;
}

const SKIPPED_QUERY = /[?&](?:inline|raw|url)\b/;

export function scopedPseudoElementReset(): Plugin {
  return {
    name: "openbot:scoped-pseudo-element-reset",
    // After Vite's CSS step has inlined `@import`s, and before it turns the stylesheet into a module.
    transform: {
      filter: { id: /\.css(?:\?.*)?$/ },
      handler(code, id) {
        if (SKIPPED_QUERY.test(id)) return null;
        const css = scopePseudoElementReset(code);
        return css === undefined ? null : { code: css, map: null };
      },
    },
  };
}
