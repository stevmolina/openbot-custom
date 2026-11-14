import { SHAPE_BY_ID, type ShapeId } from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc-agent-identity";

/*
 * The Pokebots look of a generated agent face. The fork keeps the upstream plush engine, which shows
 * what an agent does, and gives it the brand of pokebots.xyz: the brand colours and one felt
 * accessory per agent, as the Pokebots mascots wear. This module holds all of it, so that the daily
 * upstream merge touches only the two lines that call it in `bloub-avatar.ts`.
 */

/**
 * The colour of each hue, from the pokebots.xyz palette. Lime and indigo have no brand colour and keep
 * the upstream ones.
 */
export const POKEBOTS_HUE_COLORS: Readonly<Record<AvatarHue, string>> = {
  0: "#f2706a",
  30: "#f2843c",
  55: "#f5b83d",
  100: "#8ece34",
  150: "#5cc79e",
  185: "#3dbfd1",
  215: "#2f7cf6",
  245: "#5d67ee",
  280: "#9b82f0",
  320: "#ef77ad",
};

/** The hues that an agent with no colour of its own takes, brand blue, mint, purple and orange first. */
const AUTOMATIC_HUES: readonly AvatarHue[] = [215, 150, 280, 30, 0, 55, 320, 185];

/** The automatic colour of an agent. It keeps the hash key that upstream uses, so only the colour changes. */
export function pokebotsAutomaticColor(seed: string): string {
  const hue = AUTOMATIC_HUES[stableIndex(`${seed}:color`, AUTOMATIC_HUES.length)] ?? 215;
  return POKEBOTS_HUE_COLORS[hue];
}

export const POKEBOTS_ACCESSORIES = ["headphones", "sprout", "scarf", "pocket", "antenna", "bow", "star"] as const;
export type PokebotsAccessoryId = (typeof POKEBOTS_ACCESSORIES)[number];

/** The accessory of a face. Every surface takes it from the seed, so an agent wears the same one everywhere. */
export function pokebotsAccessory(seed: string): PokebotsAccessoryId {
  return POKEBOTS_ACCESSORIES[stableIndex(`${seed}:pokebots`, POKEBOTS_ACCESSORIES.length)] ?? "headphones";
}

/**
 * One layer of an accessory, as SVG path data in the plush's own frame: the view box is
 * `POKEBOTS_ACCESSORY_VIEW_BOX`, the body centre is the origin and its radius is 100.
 */
export interface PokebotsAccessoryPart {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
  opacity?: number;
}

/** The view box of the plush, so an accessory drawn in it sits on the body at every size. */
export const POKEBOTS_ACCESSORY_VIEW_BOX = "-158 -158 316 316";

/** The plush body is drawn 1.15 times larger than its box (`PLUSH_BODY_STYLE`); the accessory follows. */
export const POKEBOTS_ACCESSORY_SCALE = 1.15;

const CREAM = "#f1e4cc";
const CREAM_SHADE = "#d6c19e";
const CREAM_LIGHT = "#fff8ea";
const LEAF = "#4fb17f";
const LEAF_DEEP = "#2f8a5c";
const LEAF_LIGHT = "#9be3b9";
const CORAL = "#f2706a";
const CORAL_SHADE = "#cf4f4b";
const BLUE = "#2f7cf6";
const BLUE_SHADE = "#1d5ec4";
const LAVENDER = "#cbb8ff";
const LAVENDER_SHADE = "#a990ef";
const MINT = "#9fe6c2";
const MINT_SHADE = "#5cc79e";
const SUNNY = "#ffd166";
const SUNNY_SHADE = "#e5a92c";
const PINK = "#ff8db6";
const PINK_SHADE = "#e0628f";
const INK = "#3d4260";
const WHITE = "#ffffff";

/** The layers of an accessory on a body of this shape and colour, back to front. */
export function pokebotsAccessoryParts(
  accessory: PokebotsAccessoryId,
  shape: ShapeId,
  bodyColor: string,
): PokebotsAccessoryPart[] {
  const body = bodyOutline(shape);
  const family = colorFamily(bodyColor);
  switch (accessory) {
    case "headphones":
      return headphones(body);
    case "sprout":
      return sprout(body, family);
    case "scarf":
      return scarf(body, family);
    case "pocket":
      return pocket(family);
    case "antenna":
      return antenna(body, family);
    case "bow":
      return bow(body, family);
    case "star":
      return star(body, family);
  }
}

type ColorFamily = "warm" | "yellow" | "green" | "blue" | "purple" | "other";

interface BodyOutline {
  top: number;
  /** The distance from the centre line to the right and left edges at height `y`. */
  right: (y: number) => number;
  left: (y: number) => number;
  /** The point of the edge at an angle, in degrees, measured clockwise from the right. */
  edge: (degrees: number) => { x: number; y: number };
}

function headphones(body: BodyOutline): PokebotsAccessoryPart[] {
  const cy = -14;
  const xr = body.right(cy) + 3;
  const xl = -(body.left(cy) + 3);
  const apex = Math.max(body.top - 14, -146);
  const start = cy - 18;
  const control = start + (apex - start) / 0.75;
  const band = `M${f(xl)} ${f(start)}C${f(xl)} ${f(control)} ${f(xr)} ${f(control)} ${f(xr)} ${f(start)}`;
  const shine = `M${f(xl + 6)} ${f(start - 8)}C${f(xl + 6)} ${f(control + 6)} ${f(xr - 6)} ${f(control + 6)} ${f(xr - 6)} ${f(start - 8)}`;
  return [
    { d: band, stroke: CREAM_SHADE, strokeWidth: 17 },
    { d: band, stroke: CREAM, strokeWidth: 12 },
    { d: shine, stroke: CREAM_LIGHT, strokeWidth: 3.5, opacity: 0.9 },
    ...earCup(xr, cy, 1),
    ...earCup(xl, cy, -1),
  ];
}

function earCup(x: number, cy: number, side: 1 | -1): PokebotsAccessoryPart[] {
  const width = 30;
  const height = 50;
  const outer = x + side * (width / 2 - 4);
  return [
    { d: roundedRect(outer, cy, width, height, 14), fill: CREAM_SHADE },
    { d: roundedRect(outer - side * 2, cy - 2, width - 4, height - 6, 12), fill: CREAM },
    { d: roundedRect(outer - side * 9, cy, 9, height - 14, 4.5), fill: CREAM_SHADE, opacity: 0.7 },
    { d: roundedRect(outer + side * 5, cy - 10, 6, 16, 3), fill: CREAM_LIGHT, opacity: 0.9 },
  ];
}

function sprout(body: BodyOutline, family: ColorFamily): PokebotsAccessoryPart[] {
  const base = Math.max(body.top, -96) + 10;
  const leaf = family === "green" ? LEAF_DEEP : LEAF;
  const vein = family === "green" ? LEAF : LEAF_LIGHT;
  const stem = `M0 ${f(base)}Q3 ${f(base - 16)} 0 ${f(base - 28)}`;
  const left = `M0 ${f(base - 26)}C-8 ${f(base - 48)} -32 ${f(base - 56)} -46 ${f(base - 42)}C-36 ${f(base - 24)} -14 ${f(base - 20)} 0 ${f(base - 26)}Z`;
  const right = `M0 ${f(base - 28)}C6 ${f(base - 56)} 36 ${f(base - 66)} 54 ${f(base - 50)}C44 ${f(base - 28)} 16 ${f(base - 22)} 0 ${f(base - 28)}Z`;
  return [
    { d: stem, stroke: LEAF_DEEP, strokeWidth: 7 },
    { d: left, fill: leaf },
    { d: right, fill: leaf },
    { d: `M-4 ${f(base - 28)}Q-22 ${f(base - 40)} -38 ${f(base - 40)}`, stroke: vein, strokeWidth: 3, opacity: 0.85 },
    { d: `M4 ${f(base - 31)}Q24 ${f(base - 48)} 44 ${f(base - 49)}`, stroke: vein, strokeWidth: 3, opacity: 0.85 },
  ];
}

function scarf(body: BodyOutline, family: ColorFamily): PokebotsAccessoryPart[] {
  const warm = family === "warm";
  const knit = warm ? BLUE : CORAL;
  const shade = warm ? BLUE_SHADE : CORAL_SHADE;
  const cy = 40;
  const xr = body.right(cy) + 4;
  const xl = -(body.left(cy) + 4);
  const band = `M${f(xl)} ${f(cy - 13)}Q0 ${f(cy + 7)} ${f(xr)} ${f(cy - 13)}L${f(xr)} ${f(cy + 9)}Q0 ${f(cy + 31)} ${f(xl)} ${f(cy + 9)}Z`;
  const lower = `M${f(xl)} ${f(cy + 2)}Q0 ${f(cy + 24)} ${f(xr)} ${f(cy + 2)}L${f(xr)} ${f(cy + 9)}Q0 ${f(cy + 31)} ${f(xl)} ${f(cy + 9)}Z`;
  const tx = xr * 0.42;
  const tail = `M${f(tx)} ${f(cy + 6)}L${f(tx + 24)} ${f(cy + 2)}L${f(tx + 30)} ${f(cy + 50)}L${f(tx + 6)} ${f(cy + 53)}Z`;
  const fringe = [0, 8, 16, 24].map((step) => `M${f(tx + 7 + step)} ${f(cy + 52 - step / 8)}l1 9`).join("");
  const ribs = [-0.5, 0, 0.5]
    .map((share) => {
      const x = share * (xr - xl) * 0.8;
      return `M${f(x)} ${f(cy - 4)}l0 14`;
    })
    .join("");
  return [
    { d: band, fill: knit },
    { d: lower, fill: shade, opacity: 0.55 },
    { d: ribs, stroke: shade, strokeWidth: 3, opacity: 0.55 },
    { d: tail, fill: knit },
    { d: `M${f(tx + 3)} ${f(cy + 18)}L${f(tx + 27)} ${f(cy + 15)}`, stroke: shade, strokeWidth: 3, opacity: 0.6 },
    { d: fringe, stroke: knit, strokeWidth: 4 },
  ];
}

function pocket(family: ColorFamily): PokebotsAccessoryPart[] {
  const purple = family === "purple";
  const cloth = purple ? MINT : LAVENDER;
  const shade = purple ? MINT_SHADE : LAVENDER_SHADE;
  const cy = 42;
  return [
    { d: roundedRect(0, cy + 3, 64, 46, 11), fill: shade },
    { d: roundedRect(0, cy, 62, 44, 10), fill: cloth },
    { d: `M-31 ${cy - 11}L31 ${cy - 11}`, stroke: shade, strokeWidth: 3, opacity: 0.8 },
    { d: roundedRect(0, cy + 2, 50, 32, 7), stroke: WHITE, strokeWidth: 2.6, dash: "5 4", opacity: 0.9 },
  ];
}

function antenna(body: BodyOutline, family: ColorFamily): PokebotsAccessoryPart[] {
  const base = Math.max(body.top, -100) + 8;
  const yellow = family === "yellow" || family === "warm";
  const ball = yellow ? BLUE : SUNNY;
  const shade = yellow ? BLUE_SHADE : SUNNY_SHADE;
  const tip = base - 32;
  return [
    { d: `M0 ${f(base)}Q-4 ${f(base - 16)} 0 ${f(tip)}`, stroke: INK, strokeWidth: 6 },
    { d: circle(0, tip - 9, 13), fill: shade },
    { d: circle(-1, tip - 10, 11.5), fill: ball },
    { d: circle(-5, tip - 14, 4), fill: WHITE, opacity: 0.85 },
  ];
}

function bow(body: BodyOutline, family: ColorFamily): PokebotsAccessoryPart[] {
  const point = body.edge(-60);
  const pinkish = family === "warm";
  const ribbon = pinkish ? SUNNY : PINK;
  const shade = pinkish ? SUNNY_SHADE : PINK_SHADE;
  const at = (x: number, y: number) => rotate(x, y, 22, point.x * 0.94, point.y * 0.94);
  const loop = (side: 1 | -1) => {
    const a = at(0, 0);
    const b = at(side * 12, -20);
    const c = at(side * 34, -18);
    const d = at(side * 32, 2);
    const e = at(side * 30, 18);
    const g = at(side * 12, 12);
    return `M${f(a.x)} ${f(a.y)}C${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)} ${f(d.x)} ${f(d.y)}C${f(e.x)} ${f(e.y)} ${f(g.x)} ${f(g.y)} ${f(a.x)} ${f(a.y)}Z`;
  };
  const center = at(0, 0);
  const shine = at(-18, -8);
  return [
    { d: loop(-1), fill: ribbon, stroke: shade, strokeWidth: 3 },
    { d: loop(1), fill: ribbon, stroke: shade, strokeWidth: 3 },
    { d: circle(center.x, center.y, 8), fill: shade },
    { d: circle(shine.x, shine.y, 4), fill: WHITE, opacity: 0.7 },
  ];
}

function star(body: BodyOutline, family: ColorFamily): PokebotsAccessoryPart[] {
  const point = body.edge(-122);
  const yellow = family === "yellow" || family === "warm";
  const fill = yellow ? WHITE : SUNNY;
  const shade = yellow ? BLUE : SUNNY_SHADE;
  const cx = point.x * 0.9;
  const cy = point.y * 0.9;
  const corners: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 22 : 10;
    const angle = (Math.PI / 5) * index - Math.PI / 2 - 0.25;
    corners.push(`${f(cx + radius * Math.cos(angle))} ${f(cy + radius * Math.sin(angle))}`);
  }
  return [
    { d: `M${corners.join("L")}Z`, fill, stroke: shade, strokeWidth: 4 },
    { d: circle(cx - 5, cy - 6, 3.5), fill: WHITE, opacity: 0.8 },
  ];
}

function bodyOutline(shape: ShapeId): BodyOutline {
  const radii = SHAPE_BY_ID.get(shape)?.radii ?? [1];
  const radiusAt = (angle: number) => {
    const turn = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
    const position = turn * radii.length;
    const index = Math.floor(position);
    const from = radii[index % radii.length] ?? 1;
    const to = radii[(index + 1) % radii.length] ?? 1;
    return (from + (to - from) * (position - index)) * 100;
  };
  const point = (angle: number) => ({ x: radiusAt(angle) * Math.cos(angle), y: radiusAt(angle) * Math.sin(angle) });
  const widthAt = (y: number, side: 1 | -1) => {
    let best = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 180; step += 1) {
      const angle = -Math.PI / 2 + (Math.PI * step) / 180;
      const edge = point(side === 1 ? angle : Math.PI - angle);
      const gap = Math.abs(edge.y - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = Math.abs(edge.x);
      }
    }
    return best;
  };
  return {
    top: -radiusAt(Math.PI * 1.5),
    right: (y) => widthAt(y, 1),
    left: (y) => widthAt(y, -1),
    edge: (degrees) => point((degrees * Math.PI) / 180),
  };
}

function colorFamily(color: string): ColorFamily {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) return "other";
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.12) return "other";
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  const degrees = (hue * 60 + 360) % 360;
  if (degrees < 32 || degrees >= 320) return "warm";
  if (degrees < 70) return "yellow";
  if (degrees < 175) return "green";
  if (degrees < 235) return "blue";
  return "purple";
}

function roundedRect(cx: number, cy: number, width: number, height: number, radius: number): string {
  const x = cx - width / 2;
  const y = cy - height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  return `M${f(x + r)} ${f(y)}H${f(x + width - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + width)} ${f(y + r)}V${f(y + height - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + width - r)} ${f(y + height)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + height - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

function circle(cx: number, cy: number, radius: number): string {
  return `M${f(cx - radius)} ${f(cy)}A${f(radius)} ${f(radius)} 0 1 0 ${f(cx + radius)} ${f(cy)}A${f(radius)} ${f(radius)} 0 1 0 ${f(cx - radius)} ${f(cy)}Z`;
}

function rotate(x: number, y: number, degrees: number, cx: number, cy: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180;
  return { x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) };
}

function f(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function stableIndex(value: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}

/** The Vite brand layer enables landing artwork for Pokebots desktop and web builds. */
export const POKEBOTS_LANDING_ARTWORK = false;

export const POKEBOTS_PORTRAITS = ["blue", "mint", "orange", "purple"] as const;
export type PokebotsPortrait = (typeof POKEBOTS_PORTRAITS)[number];

export const POKEBOTS_PORTRAIT_COLORS: Readonly<Record<PokebotsPortrait, string>> = {
  blue: POKEBOTS_HUE_COLORS[215],
  mint: POKEBOTS_HUE_COLORS[150],
  orange: POKEBOTS_HUE_COLORS[30],
  purple: POKEBOTS_HUE_COLORS[280],
};

/**
 * A saved face choice keeps its original renderer. Default seeds use the landing portrait nearest
 * their saved colour. This only selects bundled artwork; it never changes the seed or stored colour.
 */
export function pokebotsDefaultPortrait(seed: string, color: string): PokebotsPortrait | null {
  if (/:(?:face|flat|avatar):\d+(?::\d+)?$/.test(seed)) return null;
  const channels = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const target = channels(color);
  let nearest: PokebotsPortrait = "blue";
  let distance = Number.POSITIVE_INFINITY;
  for (const portrait of POKEBOTS_PORTRAITS) {
    const rgb = channels(POKEBOTS_PORTRAIT_COLORS[portrait]);
    const difference = rgb.reduce((sum, channel, index) => sum + (channel - (target[index] ?? 0)) ** 2, 0);
    if (difference < distance) {
      distance = difference;
      nearest = portrait;
    }
  }
  return nearest;
}
