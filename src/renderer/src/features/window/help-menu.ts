import type { ShortcutPlatform } from "@openbot/ui/features/shortcuts/shortcut-registry";
import type { HelpMenuNews, HelpMenuProps } from "@openbot/ui/features/updates/HelpMenu";
import { whatsNewEntry } from "@openbot/ui/features/updates/whats-new";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useI18n } from "../../i18n-context";
import { runShortcutCommand } from "../shortcuts/shortcut-commands";
import { compareReleaseVersions } from "../updates/whats-new-history";
import { loadWhatsNewReleases } from "../updates/whats-new-releases";

/** The newest releases that the Help menu lists, one line each. */
const HELP_NEWS_COUNT = 3;

export type HelpDestination = "changelog" | "guides" | "discord" | "report-problem" | "feedback";

/**
 * The Help menu of the sidebar's More menu, on desktop and on the web. The first time it opens, it
 * reads the release notes in the app and lists the first note of each of the newest releases, up to
 * `version`. The web has no version: it always runs the newest release.
 */
export function createHelpMenu(options: {
  version: () => string | null;
  onOpenWhatsNew: () => void;
  onOpenLink: (destination: HelpDestination) => void;
  /** The keyboard of the device, so the shortcut item names its key. */
  shortcutPlatform?: () => ShortcutPlatform | undefined;
}): Omit<HelpMenuProps, "triggerClass"> {
  const i18n = useI18n();
  const [news, setNews] = createSignal<readonly HelpMenuNews[]>([]);
  // The list is read again after a language change, so it never stays in the previous language.
  let newsLocale: string | null = null;
  const openLink = (destination: HelpDestination) => {
    desktopAnalytics.track("help_link_opened", { destination });
    options.onOpenLink(destination);
  };
  // A load for a different language replaces this one, and the result of the old load is dropped.
  let loadingLocale: string | null = null;

  async function loadNews() {
    const locale = i18n.locale();
    if (loadingLocale === locale || (news().length > 0 && newsLocale === locale)) return;
    loadingLocale = locale;
    if (newsLocale !== locale) setNews([]);
    try {
      const version = options.version();
      const releases = await loadWhatsNewReleases(AbortSignal.timeout(10_000), locale);
      if (loadingLocale !== locale) return;
      setNews(
        releases
          .filter((release) => !version || compareReleaseVersions(release.version, version) <= 0)
          .sort((a, b) => compareReleaseVersions(b.version, a.version))
          .flatMap((release) => {
            const note = release.groups[0]?.items[0];
            return note ? [{ headline: whatsNewEntry(note).headline, date: release.date }] : [];
          })
          .slice(0, HELP_NEWS_COUNT),
      );
      newsLocale = locale;
    } catch {
      // The menu shows its links without the list. The next opening tries again.
    } finally {
      if (loadingLocale === locale) loadingLocale = null;
    }
  }

  return {
    get news() {
      return news();
    },
    onOpen: () => void loadNews(),
    onOpenWhatsNew: () => options.onOpenWhatsNew(),
    onOpenChangelog: () => openLink("changelog"),
    onOpenGuides: () => openLink("guides"),
    onOpenDiscord: () => openLink("discord"),
    onReportProblem: () => openLink("report-problem"),
    onSendFeedback: () => openLink("feedback"),
    onOpenShortcuts: () => void runShortcutCommand("shortcuts"),
    get shortcutPlatform() {
      return options.shortcutPlatform?.();
    },
  };
}
