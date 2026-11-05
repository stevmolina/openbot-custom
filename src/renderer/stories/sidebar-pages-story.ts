import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
import type { SidebarPages } from "@openbot/ui/features/sidebar/sidebar-pages";
import { fn } from "storybook/test";

/**
 * The pages of the chat sidebar for a story: every page opens, nothing is pinned but Workflows and
 * Tasks, and the help menu has no news. A story overrides what it shows.
 */
export function storySidebarPages(
  overrides: Partial<SidebarPages> & { usageRows?: readonly AccountUsageProviderRow[] } = {},
): SidebarPages {
  return {
    current: "chats",
    pinned: ["workflows", "tasks"],
    onPinChange: fn(),
    usageRows: [],
    onChats: fn(),
    onRoutines: fn(),
    onWorkflows: fn(),
    onTasks: fn(),
    onSchedule: fn(),
    onUsage: fn(),
    onMarketplace: fn(),
    onSettings: fn(),
    onCollapse: fn(),
    help: {
      news: [],
      onOpenWhatsNew: fn(),
      onOpenChangelog: fn(),
      onOpenGuides: fn(),
      onOpenDiscord: fn(),
      onSendFeedback: fn(),
    },
    ...overrides,
  };
}
