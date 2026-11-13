/**
 * What a group heading of the chat list shows: a quiet name and a small chevron after it. An open group
 * shows a chevron that points down. A closed group shows its count and a chevron that points to the
 * side, and a dot when it holds an unread chat. The caller owns the button, so a folder heading keeps
 * the menu and the drag of its section.
 */

import { ChevronRight } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { ServerMark, type ServerMarkServer } from "../servers/ServerRail";

export interface SidebarDockHeadProps {
  name: string;
  count: number;
  open: boolean;
  /** A chat in the group, or in a folder in it, has a reply that the user did not read. */
  unread: boolean;
  /** The server of a folder in the "All machines" view, as a small mark after its name. */
  server?: (ServerMarkServer & { name: string }) | undefined;
}

export function SidebarDockHeadContent(headProps: SidebarDockHeadProps) {
  const { t, format } = useText();
  return (
    <>
      <span class="sidebar-dock-name">{headProps.name}</span>
      <Show when={headProps.server}>
        {(server) => (
          <>
            <span class="sidebar-chat-server" title={server().name} aria-hidden="true">
              <ServerMark server={server()} />
            </span>
            <span class="sr-only">{t("sidebar.chat.server", { name: server().name })}</span>
          </>
        )}
      </Show>
      <Show when={!headProps.open}>
        <span class="sidebar-dock-count">{format.number(headProps.count)}</span>
      </Show>
      <Show when={!headProps.open && headProps.unread}>
        <span class="sidebar-chat-unread" aria-hidden="true" />
        <span class="sr-only">{t("sidebar.chat.unread")}</span>
      </Show>
      <ChevronRight
        class={`sidebar-dock-chevron${headProps.open ? " sidebar-dock-chevron-open" : ""}`}
        aria-hidden="true"
      />
    </>
  );
}
