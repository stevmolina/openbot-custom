/**
 * The plan usage of each AI provider account, above the pill of the chat sidebar. Each provider
 * shows as rings around its logo: the outer ring is the longest window, the inner ring the shortest,
 * and each arc shows how much is left. The open sidebar shows the rings in one row, in a tab on top of the
 * pill. The hover card lists the windows with their reset times, and a click opens the usage page.
 */

import { ProviderLogo } from "@openbot/brand";
import { Button, MotionTooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";
import { useText } from "../../text";
import { AccountUsageDetails } from "../account/AccountUsageDetails";
import { type AccountUsageProviderRow, accountUsageRowKey } from "../account/account-usage-view";
import type { SidebarCustomAgentUsage } from "./sidebar-pages";

/** Two tracks in a 34px box, with 4.5px between their centers. */
const RING = { size: 34, stroke: 2.25, spacing: 4.5 };

/**
 * Where the hover card opens: above a ring of the tab, so it leaves the other rings of the row free,
 * and beside a ring of the dock.
 */
type UsagePlacement = "top" | "right-end";

/** One usage button. The hover card shows instead of a name tooltip. */
function UsageButton(props: {
  label: string;
  placement: UsagePlacement;
  card: () => JSX.Element;
  onOpen: (button: HTMLElement) => void;
  children: JSX.Element;
}) {
  return (
    <MotionTooltip
      content={props.card()}
      class="ui-popover-menu-surface account-usage-popover sidebar-usage-card"
      placement={props.placement}
      openDelay={250}
      closeDelay={75}
    >
      <Button
        variant="ghost"
        type="button"
        class="sidebar-usage-button"
        aria-label={props.label}
        onClick={(event) => props.onOpen(event.currentTarget)}
      >
        {props.children}
      </Button>
    </MotionTooltip>
  );
}

/**
 * The rings of one provider. `shared` are the readings that count the same quota, such as Cursor on
 * a merged Grok plan: the card lists them, with no ring of their own. The ring draws the reading with
 * the least left, so a shared reading that runs out first still shows.
 */
function UsageRings(props: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
  placement: UsagePlacement;
  onOpen: (button: HTMLElement) => void;
}) {
  const { t, format } = useText();
  const rows = () => [props.row, ...props.shared];
  const ringRow = () =>
    rows().reduce((lowest, row) => ((row.remainingPercent ?? 100) < (lowest.remainingPercent ?? 100) ? row : lowest));
  const label = () =>
    t("app.rail.usageRings", {
      name: format.list(rows().map((row) => row.name)),
      windows: rows()
        .flatMap((row) => row.windows)
        .map((window) => t("account.usage.row.window", { window: window.label, percent: window.remainingPercent }))
        .join(", "),
    });
  const windows = () => [...ringRow().ringWindows].reverse().slice(0, 2);
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
    <UsageButton
      label={label()}
      placement={props.placement}
      card={() => (
        <AccountUsageDetails
          rows={rows()}
          loading={false}
          error={null}
          refreshActive={false}
          refreshDisabled
          onRefresh={() => undefined}
          title={<h2 class="account-usage-popover-title">{t("account.usage.title")}</h2>}
        />
      )}
      onOpen={props.onOpen}
    >
      <span class="sidebar-usage-ring-box">
        <svg class="sidebar-usage-ring" viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none" aria-hidden="true">
          <For each={windows()} keyed={false}>
            {(window, index) => (
              <g>
                <circle
                  class="sidebar-usage-track"
                  cx={RING.size / 2}
                  cy={RING.size / 2}
                  r={outerRadius - index * RING.spacing}
                  stroke-width={RING.stroke}
                />
                <Show when={window().remainingPercent > 0}>
                  <circle
                    class="sidebar-usage-arc"
                    data-usage-tone={window().tone}
                    cx={RING.size / 2}
                    cy={RING.size / 2}
                    r={outerRadius - index * RING.spacing}
                    stroke-width={RING.stroke}
                    stroke-linecap="round"
                    pathLength={100}
                    stroke-dasharray={`${window().remainingPercent} 100`}
                  />
                </Show>
              </g>
            )}
          </For>
        </svg>
        <ProviderLogo provider={props.row.provider} class="sidebar-usage-logo" />
      </span>
    </UsageButton>
  );
}

/** The plan usage of one custom agent: its logo, with no ring. The card shows the answer as the agent wrote it. */
function CustomAgentUsage(props: {
  row: SidebarCustomAgentUsage;
  placement: UsagePlacement;
  onOpen: (button: HTMLElement) => void;
}) {
  const { t } = useText();
  return (
    <UsageButton
      label={t("app.rail.customAgentUsage", { name: props.row.name })}
      placement={props.placement}
      card={() => (
        <div class="sidebar-agent-usage">
          <h2 class="account-usage-popover-title">{props.row.name}</h2>
          <p class="sidebar-agent-usage-text">{props.row.text}</p>
        </div>
      )}
      onOpen={props.onOpen}
    >
      <span class="sidebar-usage-ring-box">
        <ProviderLogo provider="acp" class="sidebar-usage-logo" />
      </span>
    </UsageButton>
  );
}

/**
 * The usage of each provider: a row of rings in a tab on top of the pill in the open sidebar, a column
 * in the dock. Empty, it shows nothing.
 */
export function SidebarUsage(props: {
  usageRows: readonly AccountUsageProviderRow[];
  customAgentUsage?: readonly SidebarCustomAgentUsage[] | undefined;
  layout: "tab" | "column";
  onOpen: (button: HTMLElement) => void;
}) {
  const { t } = useText();
  const placement = (): UsagePlacement => (props.layout === "tab" ? "top" : "right-end");
  /**
   * One ring per reading, except a reading that counts the quota of another provider's own sign-in,
   * such as Cursor on a merged Grok plan: that ring's card lists it instead.
   */
  const rings = createMemo(() => {
    const rows = props.usageRows.filter((row) => row.reportsUsage && row.windows.length > 0);
    const owner = (row: AccountUsageProviderRow) =>
      rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
    return rows
      .filter((row) => !owner(row))
      .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
  });
  return (
    <Show when={rings().length > 0 || (props.customAgentUsage?.length ?? 0) > 0}>
      {/* A group, not a list: each button names its provider. */}
      <fieldset
        class={["sidebar-usage", props.layout === "tab" ? "sidebar-usage-tab" : "sidebar-usage-column"]}
        aria-label={t("sidebar.usage.label")}
      >
        {/* A status update builds new rows. The key keeps each ring, and its open hover card, mounted. */}
        <For each={rings()} keyed={(ring) => accountUsageRowKey(ring.row)}>
          {(ring) => (
            <UsageRings row={ring().row} shared={ring().shared} placement={placement()} onOpen={props.onOpen} />
          )}
        </For>
        <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
          {(row) => <CustomAgentUsage row={row()} placement={placement()} onOpen={props.onOpen} />}
        </For>
      </fieldset>
    </Show>
  );
}
