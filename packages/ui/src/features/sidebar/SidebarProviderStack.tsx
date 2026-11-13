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
/** The small logos behind the front provider. The card lists the rest, so the stack stays narrow. */
const BEHIND_SIZE = 2;

/**
 * One provider of the stack: a usage reading with the readings that count the same quota, such as
 * Cursor on a merged Grok plan, or a custom agent that answers a usage prompt.
 */
type StackItem =
  | {
      kind: "usage";
      key: string;
      /** The reading that the rings draw: the one with the least left, so a shared quota that runs out shows. */
      ring: AccountUsageProviderRow;
      rows: readonly AccountUsageProviderRow[];
      left: number | null;
    }
  | { kind: "agent"; key: string; agent: SidebarCustomAgentUsage };

/** The amount left in the window that stops work first, or null when no window reported one. */
function leastLeft(row: AccountUsageProviderRow): number | null {
  if (row.remainingPercent !== null) return row.remainingPercent;
  const windows = row.windows.map((window) => window.remainingPercent);
  return windows.length > 0 ? Math.min(...windows) : null;
}

function StackLogo(props: { item: StackItem }) {
  return (
    <ProviderLogo
      provider={props.item.kind === "usage" ? props.item.ring.provider : "acp"}
      class="sidebar-provider-stack-logo"
    />
  );
}

/** The card: every reading with its rings, windows and resets, then the answers of the custom agents. */
function ProviderCard(props: {
  rows: readonly AccountUsageProviderRow[];
  agents: readonly SidebarCustomAgentUsage[];
  onOpenUsage: () => void;
}) {
  const { t } = useText();
  // The card mounts while it is open, so the clock runs only then.
  const [now, setNow] = createSignal(Date.now());
  const clock = window.setInterval(() => setNow(Date.now()), RESET_CLOCK_MS);
  onCleanup(() => window.clearInterval(clock));
  return (
    <>
      <header class="sidebar-provider-card-header">
        <Popover.Title class="sidebar-provider-card-title">{t("sidebar.pill.providersTitle")}</Popover.Title>
        <Button variant="ghost" size="sm" type="button" class="sidebar-provider-card-open" onClick={props.onOpenUsage}>
          <span>{t("sidebar.pill.openUsage")}</span>
          <ChevronRight aria-hidden="true" />
        </Button>
      </header>
      <ul class="sidebar-provider-list">
        <For each={props.rows} keyed={accountUsageRowKey}>
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
        <For each={props.agents} keyed={(agent) => agent.id}>
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
    </>
  );
}

/**
 * The stack button and its card. It mounts only while there is a provider, so its open state starts
 * closed each time: a card that closed with its provider does not open again by itself.
 */
function ProviderStackPopover(props: {
  items: readonly StackItem[];
  agents: readonly SidebarCustomAgentUsage[];
  onOpenUsage: (button: HTMLElement) => void;
}) {
  const { t, format } = useText();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLElement | undefined;
  const front = () => props.items[0];
  /** The reading of the front provider, for its rings. A custom agent in front shows its logo only. */
  const frontRing = () => {
    const item = front();
    return item?.kind === "usage" ? item.ring : undefined;
  };
  const behind = () => props.items.slice(1, 1 + BEHIND_SIZE);
  const rows = () => props.items.flatMap((item) => (item.kind === "usage" ? item.rows : []));
  const tone = (item: StackItem): AccountUsageTone | undefined => (item.kind === "usage" ? item.ring.tone : undefined);
  const label = () =>
    t("sidebar.pill.providers", {
      names: format.list([
        ...rows().map((row) => {
          const left = leastLeft(row);
          return left === null ? row.name : t("account.usage.row.window", { window: row.name, percent: left });
        }),
        ...props.agents.map((agent) => agent.name),
      ]),
    });
  return (
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
                when={frontRing()}
                fallback={
                  <Show when={front()}>
                    {(item) => (
                      <span class="sidebar-provider-stack-avatar sidebar-provider-stack-avatar-front">
                        <StackLogo item={item()} />
                      </span>
                    )}
                  </Show>
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
          </span>
        </Popover.Trigger>
      </MotionTooltip>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface sidebar-provider-card">
          <ProviderCard
            rows={rows()}
            agents={props.agents}
            onOpenUsage={() => {
              setOpen(false);
              if (trigger) props.onOpenUsage(trigger);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SidebarProviderStack(props: {
  usageRows: readonly AccountUsageProviderRow[];
  customAgentUsage?: readonly SidebarCustomAgentUsage[] | undefined;
  onOpenUsage: (button: HTMLElement) => void;
}) {
  const agents = () => props.customAgentUsage ?? [];
  /**
   * One item per ring, with the readings that share its quota. The provider with the least left comes
   * first: it is the one that runs out next. A provider that reported no amount comes last.
   */
  const items = createMemo((): StackItem[] => {
    const usage = sidebarUsageRings(props.usageRows).map((ring) => {
      const rows = [ring.row, ...ring.shared];
      const lowest = rows.reduce((least, row) => {
        const left = leastLeft(row);
        const leastValue = leastLeft(least);
        return left !== null && (leastValue === null || left < leastValue) ? row : least;
      });
      return {
        kind: "usage" as const,
        key: accountUsageRowKey(ring.row),
        ring: lowest,
        rows,
        left: leastLeft(lowest),
      };
    });
    usage.sort((a, b) => (a.left ?? Number.POSITIVE_INFINITY) - (b.left ?? Number.POSITIVE_INFINITY));
    return [...usage, ...agents().map((agent) => ({ kind: "agent" as const, key: `agent:${agent.id}`, agent }))];
  });
  return (
    <Show when={items().length > 0}>
      <ProviderStackPopover items={items()} agents={agents()} onOpenUsage={props.onOpenUsage} />
    </Show>
  );
}
