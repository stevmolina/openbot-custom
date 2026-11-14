import blue from "@openbot/brand/assets/pokebots/blue.webp?inline";
import mint from "@openbot/brand/assets/pokebots/mint.webp?inline";
import orange from "@openbot/brand/assets/pokebots/orange.webp?inline";
import purple from "@openbot/brand/assets/pokebots/purple.webp?inline";
import type { PokebotsPortrait } from "@openbot/brand/pokebots-avatar";

// Inline images also work inside the SVGs that the composer, share cards and Slack rasterize.
export const POKEBOTS_PORTRAIT_IMAGES: Readonly<Record<PokebotsPortrait, string>> = { blue, mint, orange, purple };
