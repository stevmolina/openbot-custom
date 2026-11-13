# Shared SolidJS UI

Follow the SolidJS, accessibility, and design-token guidance in
[renderer instructions](../../src/renderer/AGENTS.md).

This package owns shared primitives and feature UI: sidebar, account screens, server controls,
message rendering, composer editor, attachments, preview renderers, and reusable settings panels.
Primitives live in `src/`; feature components and their local interaction logic live in
`src/features/<domain>/`. Export features through explicit package subpaths. Shared display
models live in `src/data.ts`.

Keep app contexts, desktop persistence, host transports, and platform controllers in consumers.
Do not import renderer, main, backend, or preload code, or call `window.openbot` here.
Receive data and actions through typed props and callbacks. Move components; do not copy them.
The one exception is interface text: call `useText()` from `@openbot/ui/text` for `t`, `format`
and `errorMessage`. Do not add a `t` prop. See [docs/i18n.md](../../docs/i18n.md).
Preserve existing markup, styles, and behavior unless the user requests a design change.
Shared feature CSS lives in this package. The app stylesheet imports it in the existing order.
The exception is a large feature that few screens show, such as the workflow canvas and the diagram
board: its root component imports its stylesheet, so the web client loads it with that code. Such a
stylesheet comes after the app stylesheet, so it must select only its own feature classes, and a
later app rule must not tie with it on specificity. WebKit tests a class rule only on elements that
have the class, so this saves download and parse time, not style time.
KaTeX's stylesheet loads with KaTeX, from `MathFormula.tsx`, on the same terms.
The web client's sign-in screens load `web-sign-in.css`, an ordered part of the app stylesheet; add
a file there only when a sign-in screen needs it, and check with `bun run perf:web --phases=look`.
`features/conversation/conversation.css` is the ordered style manifest. Keep component rules in
its `styles/` directory and preserve override order. Do not import those fragments separately.
Keep platform features in typed content slots or adapters, not environment checks in shared UI.
Biome rejects desktop preload access as well as application imports; keep its boundary fixtures
in `tools/ui-foundation/fixtures` when extending the rule.

Check affected desktop, public web, preview, and Storybook consumers. Run focused checks only, as
required by the root instructions. Native mobile consumes shared brand tokens and contracts, not this UI.
