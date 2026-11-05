import { Show } from "solid-js";
import { SidebarChat } from "./SidebarChat";
import { SidebarDialogs } from "./SidebarDialogs";
import { SidebarFrame } from "./SidebarFrame";
import { SidebarNav } from "./SidebarNav";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarTopbar } from "./SidebarTopbar";
import { SidebarViewSwitch } from "./SidebarViewSwitch";
import { createSidebarScope, SidebarScopeContext } from "./sidebar-scope";
import type { SidebarProps } from "./sidebar-types";

export function Sidebar(props: SidebarProps) {
  const scope = createSidebarScope(props);
  return (
    <SidebarScopeContext value={scope}>
      <SidebarFrame compact={props.compact} chat={props.pages !== undefined}>
        <Show
          when={props.pages}
          fallback={
            <>
              <SidebarTopbar />

              <SidebarSearch />

              <Show when={props.onViewChange && !props.compact}>
                <SidebarViewSwitch />
              </Show>

              <SidebarNav />

              <Show when={!props.compact}>{props.footer}</Show>
            </>
          }
        >
          {(pages) => <SidebarChat pages={pages()} />}
        </Show>

        <SidebarDialogs />
      </SidebarFrame>
    </SidebarScopeContext>
  );
}
