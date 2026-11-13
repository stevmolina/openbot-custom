/** The selector of the last style rule of `web-sign-in.css`, which marks that stylesheet in the page. */
export const SIGN_IN_SHEET_MARK = ".openbot-web-sign-in-sheet";

/** True for the sign-in stylesheet. Tailwind puts its `@property` rules after the style rules. */
function isSignInSheet(sheet: CSSStyleSheet): boolean {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    // A stylesheet from another origin cannot be read, and it is not this one.
    return false;
  }
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if (rule instanceof CSSStyleRule) return rule.selectorText === SIGN_IN_SHEET_MARK;
  }
  return false;
}

/**
 * Turns off `web-sign-in.css` after `web-client.css` has loaded. The full stylesheet holds each of its
 * rules, later in the cascade, so the page looks the same, and WebKit no longer tests each rule twice
 * when a style changes.
 */
export function retireSignInStyles(): void {
  for (const sheet of document.styleSheets) if (isSignInSheet(sheet)) sheet.disabled = true;
}
