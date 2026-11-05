import type { HelpMenuNews, HelpMenuProps } from "@openbot/ui/features/updates/HelpMenu";
import { whatsNewEntry } from "@openbot/ui/features/updates/whats-new";
import { createSignal } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { compareReleaseVersions } from "../updates/whats-new-history";
import { loadWhatsNewReleases } from "../updates/whats-new-releases";

/** The newest releases that the Help menu lists, one line each. */
const HELP_NEWS_COUNT = 3;

export type HelpDestination = "changelog" | "guides" | "discord" | "feedback";

/**
 * The Help menu of the sidebar's More menu, on desktop and on the web. The first time it opens, it
 * reads the release notes in the app and lists the first note of each of the newest releases, up to
 * `version`. The web has no version: it always runs the newest release.
 */
export function createHelpMenu(options: {
  version: () => string | null;
  onOpenWhatsNew: () => void;
  onOpenLink: (destination: HelpDestination) => void;
}): Omit<HelpMenuProps, "triggerClass"> {
  const [news, setNews] = createSignal<readonly HelpMenuNews[]>([]);
  const openLink = (destination: HelpDestination) => {
    desktopAnalytics.track("help_link_opened", { destination });
    options.onOpenLink(destination);
  };
  let loading = false;

  async function loadNews() {
    if (loading || news().length > 0) return;
    loading = true;
    try {
      const version = options.version();
      const releases = await loadWhatsNewReleases(AbortSignal.timeout(10_000));
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
    } catch {
      // The menu shows its links without the list. The next opening tries again.
    } finally {
      loading = false;
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
    onSendFeedback: () => openLink("feedback"),
  };
}
