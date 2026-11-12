import type { AppTextKey } from "@openbot/i18n";
import { Button, ChevronLeft, MessageCircle, Search, Server, Settings } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { For } from "solid-js";

/** The pane that a phone shows: the chat list at the root, or the conversation pushed over it. */
export type WebMobilePane = "conversation" | "workspace";

/**
 * The places of the phone tab bar. They are the places that the iOS app opens from its home screen:
 * the chat list, the server drawer, the search field and the settings.
 */
export type WebPhoneTab = "chats" | "servers" | "search" | "settings";

interface PhoneTab {
  id: WebPhoneTab;
  label: AppTextKey;
  Icon: typeof MessageCircle;
}

const TABS: ReadonlyArray<PhoneTab> = [
  { id: "chats", label: "webClient.tab.chats", Icon: MessageCircle },
  { id: "servers", label: "webClient.tab.servers", Icon: Server },
  { id: "search", label: "webClient.tab.search", Icon: Search },
  { id: "settings", label: "webClient.tab.settings", Icon: Settings },
];

interface WebMobileNavigationProps {
  active: WebPhoneTab;
  onSelect: (tab: WebPhoneTab) => void;
}

/**
 * The tab bar of a phone, as on iOS: an icon over a label, the active tab in the accent colour. It sits
 * under the conversation pane, so a chat that opens covers it, and a swipe back shows it again.
 */
export function WebMobileNavigation(props: WebMobileNavigationProps) {
  const { t } = useText();
  return (
    <nav class="web-phone-tab-bar" aria-label={t("webClient.pane.navigation")}>
      <For each={TABS}>
        {(tab) => (
          <Button
            variant="ghost"
            type="button"
            class="web-phone-tab"
            data-active={props.active === tab.id ? "true" : undefined}
            aria-current={props.active === tab.id ? "page" : undefined}
            onClick={() => props.onSelect(tab.id)}
          >
            <Dynamic component={tab.Icon} aria-hidden="true" />
            <span class="web-phone-tab-label">{t(tab.label)}</span>
          </Button>
        )}
      </For>
    </nav>
  );
}

interface WebPhoneBackProps {
  onBack: () => void;
  /** Starts the swipe back from the leading edge. */
  onEdgePointerDown: (event: PointerEvent) => void;
}

/**
 * The Back button and the leading edge of a chat that a phone pushed over the list. A drag from the
 * edge follows the finger back to the list, as the iOS back swipe does.
 */
export function WebPhoneBack(props: WebPhoneBackProps) {
  const { t } = useText();
  return (
    <>
      <div class="web-phone-swipe-edge" aria-hidden="true" onPointerDown={(event) => props.onEdgePointerDown(event)} />
      <Button variant="ghost" type="button" class="web-phone-back" aria-label={t("common.back")} onClick={props.onBack}>
        <ChevronLeft aria-hidden="true" />
      </Button>
    </>
  );
}
