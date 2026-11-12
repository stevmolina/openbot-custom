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
  // A chat can show twice, such as in "Needs you" and in its folder. Only its first row counts, so a
  // step never lands on a second copy and comes back.
  const seen = new Set<string>();
  const rows = [...root.querySelectorAll<HTMLElement>(`[${SIDEBAR_CHAT_ATTRIBUTE}]`)].filter((row) => {
    const id = row.getAttribute(SIDEBAR_CHAT_ATTRIBUTE) ?? "";
    if (!shown(row) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const currentId = [...root.querySelectorAll<HTMLElement>(`[${SIDEBAR_CHAT_ATTRIBUTE}]`)]
    .find(isCurrent)
    ?.getAttribute(SIDEBAR_CHAT_ATTRIBUTE);
  const current = rows.findIndex((row) => row.getAttribute(SIDEBAR_CHAT_ATTRIBUTE) === currentId);
  let index = current >= 0 ? current : offset === 1 ? -1 : rows.length;
  for (index += offset; index >= 0 && index < rows.length; index += offset) {
    const row = rows[index];
    if (row && (!unread || row.hasAttribute("data-unread"))) return row;
  }
  return null;
}
