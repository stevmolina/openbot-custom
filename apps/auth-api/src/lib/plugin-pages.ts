import { OPENBOT_SITE_URL, type PageSocialImage } from "./site-metadata";

// The addresses and the social card of the plugin pages. They stay apart from the catalog in
// plugins.ts, because the head of every route reads them, and the catalog is about 400 KB.

/** The prefix of the plugin pages. `/plugins` itself sends a visitor to the Marketplace's Apps tab. */
export const PLUGIN_INDEX_ROUTE = "/plugins";

/** One social card for the page of every plugin. */
export const PLUGIN_PAGE_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/plugin.jpg",
  alt: "Plant an idea. Your agents do the rest. OpenBot agents among paper trees",
};

export function pluginPath(slug: string): string {
  return `${PLUGIN_INDEX_ROUTE}/${slug}`;
}

export function pluginUrl(slug: string, siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(pluginPath(slug), siteUrl).toString();
}
