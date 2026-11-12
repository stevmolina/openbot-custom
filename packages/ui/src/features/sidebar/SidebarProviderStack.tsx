/**
 * The providers in the pill of the open sidebar, as a small avatar stack: the provider with the least
 * left in front, with its usage rings, and the next providers as small logos tucked behind it. A click
 * opens a card with every provider, its rings, each window's amount left and its reset, the answers of
 * the custom agents, and a link to the usage page.
 */

import { ProviderLogo } from "@openbot/brand";
import { Button, ChevronRight, MotionTooltip, Popover } from "@openbot/ui";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useText } from "../../text";
import { AccountUsageWindowList } from "../account/AccountUsageDetails";
import { type AccountUsageProviderRow, type AccountUsageTone, accountUsageRowKey } from "../account/account-usage-view";
import { sidebarUsageRings, UsageRingGlyph } from "./SidebarUsage";
import type { SidebarCustomAgentUsage } from "./sidebar-pages";

/** The reset countdown shows minutes, so a half-minute tick keeps it current. */
const RESET_CLOCK_MS = 30_000;
/** The small logos behind the front provider. More providers show as a count. */
const BEHIND_SIZE = 2;

/** One provider of the stack: a usage reading, or a custom agent that answers a usage prompt. */
type StackItem =
  | { kind: "usage"; key: string; row: AccountUsageProviderRow }
  | { kind: "agent"; key: string; agent: SidebarCustomAgentUsage };

function StackLogo(props: { item: StackItem }) {
  return (
    <ProviderLogo
      provider={props.item.kind === "usage" ? props.item.row.provider : "acp"}
      class="sidebar-provider-stack-logo"
    />
  );
}

export function SidebarProviderStack(props: {
  usageRows: readonly AccountUsageProviderRow[];
  customAgentUsage?: readonly SidebarCustomAgentUsage[] | undefined;
  onOpenUsage: (button: HTMLElement) => void;
}) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const clock = window.setInterval(() => setNow(Date.now()), RESET_CLOCK_MS);
  onCleanup(() => window.clearInterval(clock));
  let trigger: HTMLElement | undefined;
  /** The provider with the least left comes first: it is the one that runs out next. */
  const rows = createMemo(() =>
    sidebarUsageRings(props.usageRows)
      .map((ring) => ring.row)
      .sort((a, b) => (a.remainingPercent ?? 100) - (b.remainingPercent ?? 100)),
  );
  const agents = () => props.customAgentUsage ?? [];
  const items = createMemo((): StackItem[] => [
    ...rows().map((row) => ({ kind: "usage" as const, key: accountUsageRowKey(row), row })),
    ...agents().map((agent) => ({ kind: "agent" as const, key: `agent:${agent.id}`, agent })),
  ]);
  const front = () => items()[0];
  /** The reading of the front provider, for its rings. A custom agent in front shows its logo only. */
  const frontRow = () => {
    const item = front();
    return item?.kind === "usage" ? item.row : undefined;
  };
  const behind = () => items().slice(1, 1 + BEHIND_SIZE);
  const hidden = () => Math.max(0, items().length - 1 - BEHIND_SIZE);
  const tone = (item: StackItem): AccountUsageTone | undefined => (item.kind === "usage" ? item.row.tone : undefined);
  const label = () =>
    t("sidebar.pill.providers", {
      names: format.list(
        items().map((item) =>
          item.kind === "usage"
            ? t("account.usage.row.window", { window: item.row.name, percent: item.row.remainingPercent ?? 100 })
            : item.agent.name,
        ),
      ),
    });
  return (
    <Show when={front()}>
      {(first) => (
        <Popover.Root open={open()} onOpenChange={setOpen} placement="top-end" gutter={10}>
          <MotionTooltip content={label()} suppressed={open()} placement="top">
            <Popover.Trigger
              ref={(element: HTMLElement) => {
                trigger = element;
              }}
              class="sidebar-pill-button sidebar-provider-stack"
              aria-label={label()}
            >
              <span class="sidebar-provider-stack-items" aria-hidden="true">
                <span class="sidebar-provider-stack-front">
                  <Show
                    when={frontRow()}
                    fallback={
                      <span class="sidebar-provider-stack-avatar sidebar-provider-stack-avatar-front">
                        <StackLogo item={first()} />
                      </span>
                    }
                  >
                    {(row) => <UsageRingGlyph row={row()} />}
                  </Show>
                </span>
                <For each={behind()} keyed={(item) => item.key}>
                  {(item) => (
                    <span class="sidebar-provider-stack-avatar" data-usage-tone={tone(item())}>
                      <StackLogo item={item()} />
                    </span>
                  )}
                </For>
                <Show when={hidden() > 0}>
                  <span class="sidebar-provider-stack-avatar sidebar-provider-stack-count">
                    {t("sidebar.pill.moreProviders", { number: hidden() })}
                  </span>
                </Show>
              </span>
            </Popover.Trigger>
          </MotionTooltip>
          <Popover.Portal>
            <Popover.Content class="ui-popover-menu-surface sidebar-provider-card">
              <header class="sidebar-provider-card-header">
                <Popover.Title class="sidebar-provider-card-title">{t("sidebar.pill.providersTitle")}</Popover.Title>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="sidebar-provider-card-open"
                  onClick={() => {
                    setOpen(false);
                    if (trigger) props.onOpenUsage(trigger);
                  }}
                >
                  <span>{t("sidebar.pill.openUsage")}</span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </header>
              <ul class="sidebar-provider-list">
                <For each={rows()} keyed={accountUsageRowKey}>
                  {(row) => (
                    <li class="sidebar-provider-row">
                      <span class="sidebar-provider-row-ring" aria-hidden="true">
                        <UsageRingGlyph row={row()} />
                      </span>
                      <strong class="sidebar-provider-row-name">{row().name}</strong>
                      <AccountUsageWindowList windows={row().windows} now={now()} />
                    </li>
                  )}
                </For>
                <For each={agents()} keyed={(agent) => agent.id}>
                  {(agent) => (
                    <li class="sidebar-provider-row">
                      <span class="sidebar-provider-row-ring sidebar-provider-row-agent" aria-hidden="true">
                        <ProviderLogo provider="acp" class="sidebar-usage-logo" />
                      </span>
                      <strong class="sidebar-provider-row-name">{agent().name}</strong>
                      <p class="sidebar-provider-row-text">{agent().text}</p>
                    </li>
                  )}
                </For>
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Show>
  );
}
