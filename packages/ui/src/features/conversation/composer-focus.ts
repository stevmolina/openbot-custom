const OPEN_POPUP = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Whether the composer should take focus back when the window becomes active again.
 *
 * Chromium gives focus back to the element that had it, so this only acts when that was nothing
 * (`body`, after a click in the transcript) or a control the pointer focused, such as a sidebar row.
 * A popup, a text selection, another text field or a keyboard-focused control is the user's choice.
 */
export function shouldRestoreComposerFocus(editor: HTMLElement): boolean {
  if (!editor.isConnected || editor.getAttribute("contenteditable") !== "true") return false;
  if (editor.closest("[inert], [hidden]")) return false;
  const document = editor.ownerDocument;
  const active = document.activeElement;
  if (active && editor.contains(active)) return false;
  if (document.querySelector(OPEN_POPUP)) return false;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && !editor.contains(selection.anchorNode)) return false;
  if (!active || active === document.body || active === document.documentElement) return true;
  return !active.matches(TEXT_ENTRY) && !active.matches(":focus-visible");
}

/**
 * Puts the caret at the end of the message box in view, for ⇧Esc and for a key typed while nothing
 * that takes text has the focus. It runs during the keydown, so the typed character goes to the box.
 * Returns false when no message box takes text, such as on a page without a chat.
 */
export function focusComposerEditor(root: Document): boolean {
  const editor = [...root.querySelectorAll<HTMLElement>(".composer-editor-surface[contenteditable='true']")].find(
    (element) =>
      element.closest("[inert], [aria-hidden='true'], [role='dialog'], [role='alertdialog']") === null &&
      element.getClientRects().length > 0,
  );
  if (!editor) return false;
  if (root.activeElement === editor) return true;
  editor.focus({ preventScroll: true });
  const selection = root.getSelection();
  if (selection) {
    const range = root.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}
