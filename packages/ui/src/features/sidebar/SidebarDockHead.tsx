/**
 * What a group heading of the chat dock shows: a chevron that turns when the group opens, a folder
 * icon for a folder, the name, and the count. A closed group that holds an unread chat shows a dot.
 * The caller owns the button, so a folder heading keeps the menu and the drag of its section.
 */

import { ChevronRight, Folder } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export interface SidebarDockHeadProps {
  name: string;
  count: number;
  open: boolean;
  folder?: boolean;
  /** A chat in the group, or in a folder in it, has a reply that the user did not read. */
  unread: boolean;
}

export function SidebarDockHeadContent(headProps: SidebarDockHeadProps) {
  const { t, format } = useText();
  return (
    <>
      <ChevronRight
        class={`sidebar-dock-chevron${headProps.open ? " sidebar-dock-chevron-open" : ""}`}
        aria-hidden="true"
      />
      <Show when={headProps.folder}>
        <Folder class="sidebar-dock-folder" aria-hidden="true" />
      </Show>
      <span class="sidebar-dock-name">{headProps.name}</span>
      <Show when={!headProps.open && headProps.unread}>
        <span class="sidebar-chat-unread" aria-hidden="true" />
        <span class="sr-only">{t("sidebar.chat.unread")}</span>
      </Show>
      <span class="sidebar-dock-count">{format.number(headProps.count)}</span>
    </>
  );
}
