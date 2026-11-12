/**
 * The chat that ⌥↑ and ⌥↓ open: the next row of the sidebar, in the order the rows show, so the keys
 * follow every pin, folder and order the user chose. A row in a closed folder or group is skipped.
 * With `unread`, only a row that shows the unread mark counts, as ⌥⇧↑ and ⌥⇧↓ do in Slack.
 */

/** Each chat row and dock face carries the id of its chat in this attribute. */
export const SIDEBAR_CHAT_ATTRIBUTE = "data-sidebar-chat";

function shown(row: HTMLElement): boolean {
  return row.closest("[inert], [aria-hidden='true']") === null && row.getClientRects().length > 0;
}

function isCurrent(row: HTMLElement): boolean {
  return row.getAttribute("aria-current") === "page" || row.getAttribute("aria-pressed") === "true";
}

/** The row to open, or null at the end of the list or with no such row. */
export function sidebarChatStep(root: ParentNode, offset: 1 | -1, unread: boolean): HTMLElement | null {
  const rows = [...root.querySelectorAll<HTMLElement>(`[${SIDEBAR_CHAT_ATTRIBUTE}]`)].filter(shown);
  const current = rows.find(isCurrent);
  const currentId = current?.getAttribute(SIDEBAR_CHAT_ATTRIBUTE);
  // A chat can show twice, such as in "Needs you" and in its folder: step from the row in view.
  let index = current ? rows.indexOf(current) : offset === 1 ? -1 : rows.length;
  for (index += offset; index >= 0 && index < rows.length; index += offset) {
    const row = rows[index];
    if (!row || row.getAttribute(SIDEBAR_CHAT_ATTRIBUTE) === currentId) continue;
    if (!unread || row.hasAttribute("data-unread")) return row;
  }
  return null;
}
