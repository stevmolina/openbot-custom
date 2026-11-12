/**
 * The plan usage of each AI provider account, above the pill of the dock. Each provider shows as
 * rings around its logo: the outer ring is the longest window, the inner ring the shortest, and each
 * arc shows how much is left. The hover card lists the windows with their reset times, and a click
 * opens the usage page. The open sidebar shows the providers in the pill instead; see
 * `SidebarProviderStack`.
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

/** One usage button. The hover card shows instead of a name tooltip. */
function UsageButton(props: {
  label: string;
  card: () => JSX.Element;
  onOpen: (button: HTMLElement) => void;
  children: JSX.Element;
}) {
  return (
    <MotionTooltip
      content={props.card()}
      class="ui-popover-menu-surface account-usage-popover sidebar-usage-card"
      placement="right-end"
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

/** The rings of one reading around its provider logo: the outer ring is the longest window. */
export function UsageRingGlyph(props: { row: AccountUsageProviderRow }) {
  const windows = () => [...props.row.ringWindows].reverse().slice(0, 2);
  const outerRadius = (RING.size - RING.stroke) / 2;
  return (
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
  );
}

/**
 * One ring per reading, except a reading that counts the quota of another provider's own sign-in,
 * such as Cursor on a merged Grok plan: that ring's card lists it instead.
 */
export function sidebarUsageRings(usageRows: readonly AccountUsageProviderRow[]) {
  const rows = usageRows.filter((row) => row.reportsUsage && row.windows.length > 0);
  const owner = (row: AccountUsageProviderRow) =>
    rows.find((other) => other.accountId === null && other.provider === row.sharedQuotaWith);
  return rows
    .filter((row) => !owner(row))
    .map((row) => ({ row, shared: rows.filter((other) => owner(other) === row) }));
}

/**
 * The rings of one provider. `shared` are the readings that count the same quota, such as Cursor on
 * a merged Grok plan: the card lists them, with no ring of their own. The ring draws the reading with
 * the least left, so a shared reading that runs out first still shows.
 */
function UsageRings(props: {
  row: AccountUsageProviderRow;
  shared: readonly AccountUsageProviderRow[];
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
  return (
    <UsageButton
      label={label()}
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
      <UsageRingGlyph row={ringRow()} />
    </UsageButton>
  );
}

/** The plan usage of one custom agent: its logo, with no ring. The card shows the answer as the agent wrote it. */
function CustomAgentUsage(props: { row: SidebarCustomAgentUsage; onOpen: (button: HTMLElement) => void }) {
  const { t } = useText();
  return (
    <UsageButton
      label={t("app.rail.customAgentUsage", { name: props.row.name })}
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
 * The usage of each provider in the dock: a vertical stack of overlapping rings that fans out on hover
 * or focus. Empty, it shows nothing.
 */
export function SidebarUsage(props: {
  usageRows: readonly AccountUsageProviderRow[];
  customAgentUsage?: readonly SidebarCustomAgentUsage[] | undefined;
  onOpen: (button: HTMLElement) => void;
}) {
  const { t } = useText();
  const rings = createMemo(() => sidebarUsageRings(props.usageRows));
  return (
    <Show when={rings().length > 0 || (props.customAgentUsage?.length ?? 0) > 0}>
      {/* A group, not a list: each button names its provider. */}
      <fieldset class="sidebar-usage sidebar-usage-column" aria-label={t("sidebar.usage.label")}>
        {/* A status update builds new rows. The key keeps each ring, and its open hover card, mounted. */}
        <For each={rings()} keyed={(ring) => accountUsageRowKey(ring.row)}>
          {(ring) => <UsageRings row={ring().row} shared={ring().shared} onOpen={props.onOpen} />}
        </For>
        <For each={props.customAgentUsage ?? []} keyed={(row) => row.id}>
          {(row) => <CustomAgentUsage row={row()} onOpen={props.onOpen} />}
        </For>
      </fieldset>
    </Show>
  );
}
