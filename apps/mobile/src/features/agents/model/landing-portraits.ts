import type { PokebotsPortrait } from "@openbot/brand/pokebots-avatar";

/** Shared by native views and PNG files for notifications and sharing. */
export const LANDING_PORTRAITS: Readonly<Record<PokebotsPortrait, number>> = {
  blue: require("@openbot/brand/assets/pokebots/blue.webp"),
  mint: require("@openbot/brand/assets/pokebots/mint.webp"),
  orange: require("@openbot/brand/assets/pokebots/orange.webp"),
  purple: require("@openbot/brand/assets/pokebots/purple.webp"),
};
