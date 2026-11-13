import type { PageText } from "../../lib/page-text";
import type { MarketplaceMissingText } from "./marketplace-page-text";

// The route head reads this too. It stays apart from the page, so the head does not load the site
// header with every route.
export type MarketplaceMissingData = Pick<PageText<MarketplaceMissingText>, "lang" | "text">;

/** The data a listing route throws with `notFound`. A not-found error from anywhere else has none. */
export function isMarketplaceMissingData(value: unknown): value is MarketplaceMissingData {
  if (typeof value !== "object" || value === null || !("text" in value) || !("lang" in value)) return false;
  const text = value.text;
  return (
    typeof value.lang === "string" &&
    typeof text === "object" &&
    text !== null &&
    "title" in text &&
    "body" in text &&
    "open" in text &&
    typeof text.title === "string" &&
    typeof text.body === "string" &&
    typeof text.open === "string"
  );
}
